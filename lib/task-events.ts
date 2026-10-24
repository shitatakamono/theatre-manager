import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type FieldValue,
  type Firestore,
} from "firebase/firestore";
import {
  buildProductionTaskViews,
  toCustomProductionTask,
  type ProductionSectionSlug,
  type ProductionTaskSource,
  type ProductionTaskStatus,
  type ProductionTaskView,
} from "./production-task-view.ts";
import type { ProjectPerformanceData } from "./performance.ts";
import type { ProductionManagement } from "./venue-management.ts";

export const TASK_EVENT_SOURCES = ["standard", "accountingCustom", "customTask"] as const satisfies readonly ProductionTaskSource[];
export const TASK_EVENT_TYPES = ["taskCreated", "statusChanged", "taskCompleted", "taskReopened"] as const;
export const TASK_EVENT_STATUSES = ["not_started", "in_progress", "completed", "on_hold"] as const;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];
export type TaskEventStatus = (typeof TASK_EVENT_STATUSES)[number];

export type TaskEventDraft = {
  taskId: string;
  taskSource: ProductionTaskSource;
  section: ProductionSectionSlug | null;
  eventType: TaskEventType;
  beforeStatus: TaskEventStatus | null;
  afterStatus: TaskEventStatus;
  taskTitle: string;
  performanceDateSnapshot: string | null;
  userUid: string;
};

export type TaskEvent = TaskEventDraft & {
  id: string;
  occurredAt: unknown;
};

type CustomTaskLike = Parameters<typeof toCustomProductionTask>[1];

export type CustomTaskCreateData = {
  title: string;
  stage?: string;
  category_parent?: string;
  category_child?: string;
};

function eventStatus(status: ProductionTaskStatus): TaskEventStatus {
  if (status === "in-progress") return "in_progress";
  if (status === "complete") return "completed";
  if (status === "on-hold") return "on_hold";
  return "not_started";
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function getPerformanceDateSnapshot(project: DocumentData): string | null {
  const performanceDates = Array.isArray(project.performances)
    ? project.performances
      .map((performance: unknown) => (performance && typeof performance === "object"
        ? (performance as { date?: unknown }).date
        : null))
      .filter(validDate)
      .sort()
    : [];
  if (performanceDates[0]) return performanceDates[0];
  for (const candidate of [project.show_start_date, project.start_date]) {
    if (validDate(candidate)) return candidate;
  }
  return null;
}

function toProjectRecord(projectId: string, project: DocumentData) {
  return {
    id: projectId,
    legacyTitle: typeof project.title === "string" ? project.title : undefined,
    data: {
      performances: Array.isArray(project.performances) ? project.performances : [],
    } as ProjectPerformanceData,
    production: project.production as ProductionManagement | undefined,
  };
}

export function buildTaskEventPayload(draft: TaskEventDraft, occurredAt: FieldValue) {
  return { ...draft, occurredAt };
}

export function buildTaskCreatedEvent(input: {
  projectId: string;
  task: CustomTaskLike;
  userUid: string;
  performanceDateSnapshot: string | null;
}): TaskEventDraft {
  const task = toCustomProductionTask(input.projectId, input.task);
  return {
    taskId: task.id,
    taskSource: task.source,
    section: task.section,
    eventType: "taskCreated",
    beforeStatus: null,
    afterStatus: eventStatus(task.status),
    taskTitle: task.title,
    performanceDateSnapshot: input.performanceDateSnapshot,
    userUid: input.userUid,
  };
}

export function buildTaskTransitionEvent(
  before: ProductionTaskView,
  after: ProductionTaskView,
  userUid: string,
  performanceDateSnapshot: string | null
): TaskEventDraft | null {
  const beforeStatus = eventStatus(before.status);
  const afterStatus = eventStatus(after.status);
  if (before.id !== after.id || beforeStatus === afterStatus) return null;

  const eventType: TaskEventType = afterStatus === "completed"
    ? "taskCompleted"
    : beforeStatus === "completed"
      ? "taskReopened"
      : "statusChanged";
  return {
    taskId: after.id,
    taskSource: after.source,
    section: after.section,
    eventType,
    beforeStatus,
    afterStatus,
    taskTitle: after.title,
    performanceDateSnapshot,
    userUid,
  };
}

export function buildCustomTaskTransitionEvent(input: {
  projectId: string;
  before: CustomTaskLike;
  after: CustomTaskLike;
  userUid: string;
  performanceDateSnapshot: string | null;
}): TaskEventDraft | null {
  return buildTaskTransitionEvent(
    toCustomProductionTask(input.projectId, input.before),
    toCustomProductionTask(input.projectId, input.after),
    input.userUid,
    input.performanceDateSnapshot
  );
}

export function buildProductionTaskTransitionEvents(input: {
  projectId: string;
  beforeProject: DocumentData;
  afterProject: DocumentData;
  section: ProductionSectionSlug;
  userUid: string;
}): TaskEventDraft[] {
  const beforeTasks = buildProductionTaskViews(toProjectRecord(input.projectId, input.beforeProject), [])
    .filter((task) => task.section === input.section && task.source !== "customTask");
  const afterTasks = buildProductionTaskViews(toProjectRecord(input.projectId, input.afterProject), [])
    .filter((task) => task.section === input.section && task.source !== "customTask");
  const beforeById = new Map(beforeTasks.map((task) => [task.id, task]));
  const performanceDateSnapshot = getPerformanceDateSnapshot(input.beforeProject);

  return afterTasks.flatMap((after) => {
    const before = beforeById.get(after.id);
    if (!before) return [];
    const event = buildTaskTransitionEvent(before, after, input.userUid, performanceDateSnapshot);
    return event ? [event] : [];
  });
}

export function withProductionBlock(
  project: DocumentData,
  section: ProductionSectionSlug,
  block: string,
  value: unknown
): DocumentData {
  const production = project.production && typeof project.production === "object" ? project.production : {};
  const sectionValue = production[section] && typeof production[section] === "object" ? production[section] : {};
  return {
    ...project,
    production: {
      ...production,
      [section]: { ...sectionValue, [block]: value },
    },
  };
}

export function withVenueSection(project: DocumentData, section: string, value: unknown): DocumentData {
  if (section !== "contract") return withProductionBlock(project, "venue", section, value);
  const production = project.production && typeof project.production === "object" ? project.production : {};
  const venue = production.venue && typeof production.venue === "object" ? production.venue : {};
  return {
    ...project,
    production: {
      ...production,
      venue: { ...venue, ...(value && typeof value === "object" ? value : {}) },
    },
  };
}

export async function createCustomTaskWithEvent(
  firestore: Firestore,
  projectId: string,
  data: CustomTaskCreateData,
  userUid: string
): Promise<string> {
  const projectRef = doc(firestore, "projects", projectId);
  const taskRef = doc(collection(projectRef, "tasks"));
  const eventRef = doc(collection(projectRef, "taskEvents"));
  const task = {
    title: data.title,
    stage: data.stage ?? "",
    category_parent: data.category_parent ?? "",
    category_child: data.category_child ?? "",
    done: false,
    createdAt: serverTimestamp(),
  };
  await runTransaction(firestore, async (transaction) => {
    const project = await transaction.get(projectRef);
    if (!project.exists()) throw new Error("公演が見つかりません");
    transaction.set(taskRef, task);
    transaction.set(eventRef, buildTaskEventPayload(buildTaskCreatedEvent({
      projectId,
      task: { id: taskRef.id, ...task },
      userUid,
      performanceDateSnapshot: getPerformanceDateSnapshot(project.data()),
    }), serverTimestamp()));
  });
  return taskRef.id;
}

export async function toggleCustomTaskWithEvent(
  firestore: Firestore,
  projectId: string,
  taskId: string,
  done: boolean,
  userUid: string
): Promise<void> {
  const projectRef = doc(firestore, "projects", projectId);
  const taskRef = doc(projectRef, "tasks", taskId);
  const eventRef = doc(collection(projectRef, "taskEvents"));
  await runTransaction(firestore, async (transaction) => {
    const [project, taskSnapshot] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(taskRef),
    ]);
    if (!project.exists()) throw new Error("公演が見つかりません");
    if (!taskSnapshot.exists()) throw new Error("タスクが見つかりません");
    const before = { id: taskSnapshot.id, ...(taskSnapshot.data() as Omit<CustomTaskLike, "id">) } as CustomTaskLike;
    const after = { ...before, done };
    const taskEvent = buildCustomTaskTransitionEvent({
      projectId,
      before,
      after,
      userUid,
      performanceDateSnapshot: getPerformanceDateSnapshot(project.data()),
    });
    transaction.update(taskRef, { done });
    if (taskEvent) transaction.set(eventRef, buildTaskEventPayload(taskEvent, serverTimestamp()));
  });
}
