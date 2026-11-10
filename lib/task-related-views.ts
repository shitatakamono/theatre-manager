export const TASK_RELATED_VIEW_DEFINITIONS = [
  { id: "project-info", label: "公演情報", path: "info" },
  { id: "rehearsals", label: "稽古スケジュール", path: "rehearsals" },
  { id: "people", label: "関係者管理", path: "people" },
  { id: "attendance", label: "出欠管理", path: "attendance/manage" },
  { id: "members", label: "システム利用者", path: "members" },
  { id: "production-venue", label: "会場管理", path: "production/venue" },
  { id: "production-flyer", label: "チラシ管理", path: "production/flyer" },
  { id: "production-dm", label: "DM管理", path: "production/dm" },
  { id: "production-web", label: "WEB／SNS", path: "production/web" },
  { id: "production-tickets", label: "チケット", path: "production/tickets" },
  { id: "production-reception", label: "当日受付", path: "production/reception" },
  { id: "production-accounting", label: "会計", path: "production/accounting" },
  { id: "external-performances", label: "折込管理", path: "external-performances" },
  { id: "production-assets", label: "制作素材", path: "assets" },
] as const;

export type TaskRelatedView = (typeof TASK_RELATED_VIEW_DEFINITIONS)[number]["id"];

export function isTaskRelatedView(value: unknown): value is TaskRelatedView {
  return typeof value === "string"
    && TASK_RELATED_VIEW_DEFINITIONS.some((definition) => definition.id === value);
}

export function getTaskRelatedViewLabel(value: unknown): string | null {
  return TASK_RELATED_VIEW_DEFINITIONS.find((definition) => definition.id === value)?.label ?? null;
}

export function getTaskRelatedViewHref(projectId: string, value: unknown): string | null {
  const definition = TASK_RELATED_VIEW_DEFINITIONS.find((candidate) => candidate.id === value);
  return definition ? `/projects/${encodeURIComponent(projectId)}/${definition.path}` : null;
}
