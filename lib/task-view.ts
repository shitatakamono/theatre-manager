import type { ProductionTaskView } from "./production-task-view.ts";

export type TaskProgressStatus = "not-started" | "in-progress" | "complete" | "on-hold";
export type TaskDeadlineWarning = "none" | "within14Days" | "within7Days" | "overdue";
export type TaskListFilter = "all" | "mine" | "incomplete" | "due-soon";
export type { ProductionSectionSlug } from "./production-task-view.ts";
export type TaskCreateInput = {
  title: string;
  stage: string;
  category_parent: string;
  category_child: string;
};

export const TASK_STATUS_LABELS: Record<TaskProgressStatus, string> = {
  "not-started": "未着手",
  "in-progress": "進行中",
  complete: "完了",
  "on-hold": "保留",
};

export const TASK_WARNING_LABELS: Record<Exclude<TaskDeadlineWarning, "none">, string> = {
  within14Days: "14日以内",
  within7Days: "7日以内",
  overdue: "期限超過",
};

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export function buildTaskCreateInput(input: TaskCreateInput): TaskCreateInput | null {
  const title = input.title.trim();
  if (!title) return null;
  return {
    title,
    stage: input.stage.trim(),
    category_parent: input.category_parent.trim(),
    category_child: input.category_child.trim(),
  };
}

export function getTaskProgressStatus(task: ProductionTaskView): TaskProgressStatus {
  return task.status;
}

export function getTaskDueDate(task: ProductionTaskView): string | null {
  return task.dueDate;
}

export function formatTaskDueDate(value: string | null): string {
  if (!value) return "—";
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

export function getTaskAssignee(task: ProductionTaskView): string {
  return task.assignee ?? "未設定";
}

export function getTaskDeadlineWarning(task: ProductionTaskView, today: string): TaskDeadlineWarning {
  if (getTaskProgressStatus(task) === "complete") return "none";
  const dueDate = getTaskDueDate(task);
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return "none";
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const current = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(current)) return "none";
  const days = Math.round((due - current) / DAY_IN_MILLISECONDS);
  if (days < 0) return "overdue";
  if (days <= 7) return "within7Days";
  if (days <= 14) return "within14Days";
  return "none";
}

export function getTaskSection(task: ProductionTaskView) {
  return task.section;
}

const warningPriority: Record<TaskDeadlineWarning, number> = {
  none: 0,
  within14Days: 1,
  within7Days: 2,
  overdue: 3,
};

export function aggregateTaskWarning(tasks: readonly ProductionTaskView[], today: string): TaskDeadlineWarning {
  return tasks.reduce<TaskDeadlineWarning>((strongest, task) => {
    const warning = getTaskDeadlineWarning(task, today);
    return warningPriority[warning] > warningPriority[strongest] ? warning : strongest;
  }, "none");
}

export function sortTasksByDeadline(tasks: readonly ProductionTaskView[]): ProductionTaskView[] {
  return tasks.map((task, index) => ({ task, index })).sort((left, right) => {
    const leftDate = getTaskDueDate(left.task);
    const rightDate = getTaskDueDate(right.task);
    if (leftDate && rightDate && leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    if (leftDate && !rightDate) return -1;
    if (!leftDate && rightDate) return 1;
    return left.index - right.index;
  }).map(({ task }) => task);
}

export function filterTasks(
  tasks: readonly ProductionTaskView[],
  filter: TaskListFilter,
  currentUser: { uid?: string; displayName?: string } | null,
  today: string
): ProductionTaskView[] {
  return sortTasksByDeadline(tasks.filter((task) => {
    if (filter === "incomplete") return getTaskProgressStatus(task) !== "complete";
    if (filter === "due-soon") return getTaskDeadlineWarning(task, today) !== "none";
    if (filter === "mine") {
      if (!currentUser) return false;
      return Boolean(
        (task.assigneeUid && task.assigneeUid === currentUser.uid) ||
        (currentUser.displayName && task.assignee === currentUser.displayName)
      );
    }
    return true;
  }));
}

export function getTokyoDateString(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
