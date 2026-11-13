import {
  collection,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type FieldValue,
  type Firestore,
} from "firebase/firestore";
import {
  buildProductionTaskViews,
  getFlyerRecordTaskId,
  toCustomProductionTask,
  type ProductionSectionSlug,
  type ProductionTaskSource,
  type ProductionTaskStatus,
  type ProductionTaskView,
} from "./production-task-view.ts";
import type { ProjectPerformanceData } from "./performance.ts";
import type { ProductionManagement } from "./venue-management.ts";
import { isTaskRelatedView, type TaskRelatedView } from "./task-related-views.ts";

export const TASK_EVENT_SOURCES = ["standard", "accountingCustom", "customTask"] as const satisfies readonly ProductionTaskSource[];
export const TASK_EVENT_TYPES = ["taskCreated", "taskUpdated", "taskDeleted", "statusChanged", "taskCompleted", "taskReopened"] as const;
export const TASK_EVENT_STATUSES = ["not_started", "in_progress", "completed", "on_hold"] as const;

export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];
export type TaskEventStatus = (typeof TASK_EVENT_STATUSES)[number];

export const TASK_EVENT_CHANGE_FIELDS = [
  "title", "assigneeUid", "assigneeName", "dueDate", "priority", "categoryParent", "categoryChild",
] as const;

export type TaskEventChangeField = (typeof TASK_EVENT_CHANGE_FIELDS)[number];
export type TaskEventChanges = Partial<Record<TaskEventChangeField, { before: string; after: string }>>;

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
  changes?: TaskEventChanges;
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
  dueDate?: string;
  status?: ProductionTaskStatus;
  priority?: "low" | "normal" | "high";
  assigneeUid?: string;
  assigneeName?: string;
  note?: string;
  relatedView?: TaskRelatedView | "" | null;
};

type NormalizedCustomTaskData = Omit<Required<CustomTaskCreateData>, "relatedView"> & {
  relatedView?: TaskRelatedView | null;
};

function normalizeCustomTaskData(data: CustomTaskCreateData): NormalizedCustomTaskData {
  const title = data.title.trim();
  if (!title || title.length > 200) throw new Error("タスク名を正しく入力してください");
  const dueDate = data.dueDate?.trim() ?? "";
  if (dueDate && !validDate(dueDate)) throw new Error("期限を正しく入力してください");
  const status = data.status ?? "not-started";
  if (!["not-started", "in-progress", "complete", "on-hold"].includes(status)) {
    throw new Error("タスクの状態が不正です");
  }
  const priority = data.priority ?? "normal";
  if (!["low", "normal", "high"].includes(priority)) throw new Error("優先度が不正です");
  const note = data.note?.trim() ?? "";
  if (note.length > 2000) throw new Error("メモは2000文字以内で入力してください");
  if (data.relatedView && !isTaskRelatedView(data.relatedView)) throw new Error("関連画面が不正です");
  return {
    title,
    stage: data.stage?.trim() ?? "",
    category_parent: data.category_parent?.trim() ?? "",
    category_child: data.category_child?.trim() ?? "",
    dueDate,
    status,
    priority,
    assigneeUid: data.assigneeUid?.trim() ?? "",
    assigneeName: data.assigneeName?.trim() ?? "",
    note,
    ...(Object.hasOwn(data, "relatedView") ? { relatedView: data.relatedView || null } : {}),
  };
}

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

export function buildCustomTaskLifecycleEvent(input: {
  projectId: string;
  task: CustomTaskLike;
  eventType: "taskUpdated" | "taskDeleted";
  userUid: string;
  performanceDateSnapshot: string | null;
}): TaskEventDraft {
  const task = toCustomProductionTask(input.projectId, input.task);
  const status = eventStatus(task.status);
  return {
    taskId: task.id,
    taskSource: task.source,
    section: task.section,
    eventType: input.eventType,
    beforeStatus: status,
    afterStatus: status,
    taskTitle: task.title,
    performanceDateSnapshot: input.performanceDateSnapshot,
    userUid: input.userUid,
  };
}

function customTaskText(task: CustomTaskLike, key: "category_parent" | "category_child"): string {
  const value = task[key];
  return typeof value === "string" ? value.trim() : "";
}

export function buildCustomTaskChanges(
  projectId: string,
  before: CustomTaskLike,
  after: CustomTaskLike
): TaskEventChanges {
  const beforeView = toCustomProductionTask(projectId, before);
  const afterView = toCustomProductionTask(projectId, after);
  const values: Record<TaskEventChangeField, [string, string]> = {
    title: [beforeView.title, afterView.title],
    assigneeUid: [beforeView.assigneeUid ?? "", afterView.assigneeUid ?? ""],
    assigneeName: [beforeView.assignee ?? "", afterView.assignee ?? ""],
    dueDate: [beforeView.dueDate ?? "", afterView.dueDate ?? ""],
    priority: [beforeView.priority ?? "", afterView.priority ?? ""],
    categoryParent: [customTaskText(before, "category_parent"), customTaskText(after, "category_parent")],
    categoryChild: [customTaskText(before, "category_child"), customTaskText(after, "category_child")],
  };
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, [beforeValue, afterValue]]) => beforeValue !== afterValue)
      .map(([field, [beforeValue, afterValue]]) => [field, { before: beforeValue, after: afterValue }])
  ) as TaskEventChanges;
}

function withChanges(event: TaskEventDraft, changes: TaskEventChanges): TaskEventDraft {
  return Object.keys(changes).length > 0 ? { ...event, changes } : event;
}

function customTaskSemanticData(projectId: string, task: CustomTaskLike) {
  const view = toCustomProductionTask(projectId, task);
  return {
    title: view.title,
    stage: typeof task.stage === "string" ? task.stage.trim() : "",
    categoryParent: customTaskText(task, "category_parent"),
    categoryChild: customTaskText(task, "category_child"),
    dueDate: view.dueDate ?? "",
    status: view.status,
    priority: view.priority ?? "normal",
    assigneeUid: view.assigneeUid ?? "",
    assigneeName: view.assignee ?? "",
    note: view.note ?? "",
    relatedView: view.relatedView ?? null,
  };
}

function customTaskChanged(projectId: string, before: CustomTaskLike, after: CustomTaskLike): boolean {
  return JSON.stringify(customTaskSemanticData(projectId, before))
    !== JSON.stringify(customTaskSemanticData(projectId, after));
}

export function buildCustomTaskUpdatedEvent(input: {
  projectId: string;
  before: CustomTaskLike;
  after: CustomTaskLike;
  userUid: string;
  performanceDateSnapshot: string | null;
}): TaskEventDraft {
  return withChanges(buildCustomTaskLifecycleEvent({
    projectId: input.projectId,
    task: input.after,
    eventType: "taskUpdated",
    userUid: input.userUid,
    performanceDateSnapshot: input.performanceDateSnapshot,
  }), buildCustomTaskChanges(input.projectId, input.before, input.after));
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
  const event = buildTaskTransitionEvent(
    toCustomProductionTask(input.projectId, input.before),
    toCustomProductionTask(input.projectId, input.after),
    input.userUid,
    input.performanceDateSnapshot
  );
  return event ? withChanges(event, buildCustomTaskChanges(input.projectId, input.before, input.after)) : null;
}

function isExplicitDynamicTask(task: ProductionTaskView): boolean {
  if (task.source === "accountingCustom") return true;
  return task.source === "standard" && (
    /^standard:venue:documents:[^:]+$/.test(task.id)
    || /^standard:reception:preparations:custom:[^:]+$/.test(task.id)
    || /^standard:reception:merchandise:custom:[^:]+$/.test(task.id)
    || /^standard:reception:closing:[^:]+:custom:[^:]+$/.test(task.id)
  );
}

function buildDynamicTaskLifecycleEvent(
  task: ProductionTaskView,
  eventType: "taskCreated" | "taskDeleted",
  userUid: string,
  performanceDateSnapshot: string | null
): TaskEventDraft {
  const status = eventStatus(task.status);
  return {
    taskId: task.id,
    taskSource: task.source,
    section: task.section,
    eventType,
    beforeStatus: eventType === "taskCreated" ? null : status,
    afterStatus: status,
    taskTitle: task.title,
    performanceDateSnapshot,
    userUid,
  };
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
  const afterById = new Map(afterTasks.map((task) => [task.id, task]));
  const performanceDateSnapshot = getPerformanceDateSnapshot(input.beforeProject);

  const events = afterTasks.flatMap((after) => {
    const before = beforeById.get(after.id);
    if (!before) return isExplicitDynamicTask(after)
      ? [buildDynamicTaskLifecycleEvent(after, "taskCreated", input.userUid, performanceDateSnapshot)]
      : [];
    const event = buildTaskTransitionEvent(before, after, input.userUid, performanceDateSnapshot);
    return event ? [event] : [];
  });
  for (const before of beforeTasks) {
    if (!afterById.has(before.id) && isExplicitDynamicTask(before)) {
      events.push(buildDynamicTaskLifecycleEvent(before, "taskDeleted", input.userUid, performanceDateSnapshot));
    }
  }
  return events;
}

type FlyerTaskEventInput = {
  id: string;
  name: string;
  enabled: boolean;
  submissionDate?: string;
  deliveryDate?: string;
};

export function buildFlyerTaskTransitionEvents(input: {
  before: FlyerTaskEventInput;
  after: FlyerTaskEventInput;
  userUid: string;
  performanceDateSnapshot: string | null;
}): TaskEventDraft[] {
  if (!input.before.enabled || !input.after.enabled) return [];
  return ([
    ["submission", "入稿", Boolean(input.before.submissionDate), Boolean(input.after.submissionDate)],
    ["delivery", "納品", Boolean(input.before.deliveryDate), Boolean(input.after.deliveryDate)],
  ] as const).flatMap(([kind, label, beforeDone, afterDone]) => {
    if (beforeDone === afterDone) return [];
    const beforeStatus: TaskEventStatus = beforeDone ? "completed" : "not_started";
    const afterStatus: TaskEventStatus = afterDone ? "completed" : "not_started";
    return [{
      taskId: getFlyerRecordTaskId(input.after.id, kind),
      taskSource: "standard" as const,
      section: "flyer" as const,
      eventType: afterDone ? "taskCompleted" as const : "taskReopened" as const,
      beforeStatus,
      afterStatus,
      taskTitle: `${input.after.name} ${label}`,
      performanceDateSnapshot: input.performanceDateSnapshot,
      userUid: input.userUid,
    }];
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
  const values = normalizeCustomTaskData(data);
  const { relatedView, ...taskValues } = values;
  const status = values.status;
  const task = {
    ...taskValues,
    ...(relatedView ? { relatedView } : {}),
    status,
    source: "custom" as const,
    done: status === "complete",
    createdAt: serverTimestamp(),
    createdByUid: userUid,
    updatedAt: serverTimestamp(),
    updatedByUid: userUid,
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

export async function updateCustomTaskWithEvent(
  firestore: Firestore,
  projectId: string,
  taskId: string,
  data: CustomTaskCreateData,
  userUid: string
): Promise<void> {
  const values = normalizeCustomTaskData(data);
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
    if (taskSnapshot.data().source && taskSnapshot.data().source !== "custom") {
      throw new Error("追加タスク以外は編集できません");
    }
    const before = { id: taskSnapshot.id, ...(taskSnapshot.data() as Omit<CustomTaskLike, "id">) } as CustomTaskLike;
    const status = values.status;
    const hasRelatedView = Object.hasOwn(values, "relatedView");
    const { relatedView, ...taskValues } = values;
    const updates = {
      ...taskValues,
      ...(hasRelatedView ? { relatedView: relatedView ?? deleteField() } : {}),
      status,
      source: "custom" as const,
      done: status === "complete",
      updatedAt: serverTimestamp(),
      updatedByUid: userUid,
    };
    const after = { ...before, ...taskValues, status, source: "custom" as const, done: status === "complete" } as CustomTaskLike;
    if (hasRelatedView) {
      if (relatedView) after.relatedView = relatedView;
      else delete after.relatedView;
    }
    if (!customTaskChanged(projectId, before, after)) return;
    const performanceDateSnapshot = getPerformanceDateSnapshot(project.data());
    const event = buildCustomTaskTransitionEvent({ projectId, before, after, userUid, performanceDateSnapshot })
      ?? buildCustomTaskUpdatedEvent({ projectId, before, after, userUid, performanceDateSnapshot });
    transaction.update(taskRef, updates);
    transaction.set(eventRef, buildTaskEventPayload(event, serverTimestamp()));
  });
}

export async function deleteCustomTaskWithEvent(
  firestore: Firestore,
  projectId: string,
  taskId: string,
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
    if (taskSnapshot.data().source && taskSnapshot.data().source !== "custom") {
      throw new Error("追加タスク以外は削除できません");
    }
    const task = { id: taskSnapshot.id, ...(taskSnapshot.data() as Omit<CustomTaskLike, "id">) } as CustomTaskLike;
    const event = buildCustomTaskLifecycleEvent({
      projectId,
      task,
      eventType: "taskDeleted",
      userUid,
      performanceDateSnapshot: getPerformanceDateSnapshot(project.data()),
    });
    transaction.delete(taskRef);
    transaction.set(eventRef, buildTaskEventPayload(event, serverTimestamp()));
  });
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
    const nextStatus: ProductionTaskStatus = done ? "complete" : "not-started";
    const after = { ...before, done, status: nextStatus };
    const normalized = normalizeCustomTaskData({ ...before, status: after.status });
    const { relatedView, ...taskValues } = normalized;
    const taskEvent = buildCustomTaskTransitionEvent({
      projectId,
      before,
      after,
      userUid,
      performanceDateSnapshot: getPerformanceDateSnapshot(project.data()),
    });
    transaction.update(taskRef, {
      ...taskValues,
      ...(relatedView ? { relatedView } : {}),
      source: "custom",
      done,
      status: after.status,
      updatedAt: serverTimestamp(),
      updatedByUid: userUid,
    });
    if (taskEvent) transaction.set(eventRef, buildTaskEventPayload(taskEvent, serverTimestamp()));
  });
}
