import type { ProjectRole } from "./auth.ts";

export const FEEDBACK_TYPES = ["bug", "improvement", "confusing", "other"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export const FEEDBACK_STATUSES = ["unreviewed", "planned", "resolved", "wontfix"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export const FEEDBACK_TYPE_DETAILS: Record<FeedbackType, { label: string; description: string }> = {
  bug: { label: "不具合", description: "保存できない・表示がおかしい・エラーが出た等" },
  improvement: { label: "改善要望", description: "こうしてほしい・こうできると便利" },
  confusing: { label: "分かりにくい", description: "操作方法や意味が分からなかった" },
  other: { label: "その他", description: "上記以外で気づいたこと" },
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  unreviewed: "未確認",
  planned: "対応予定",
  resolved: "対応済",
  wontfix: "見送り",
};

export type Feedback = {
  id: string;
  type: FeedbackType;
  body: string;
  status: FeedbackStatus;
  reporterUid: string;
  reporterName: string;
  reporterRole: ProjectRole;
  currentPath: string;
  pageLabel: string;
  adminNote: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type FeedbackCreateInput = {
  type: FeedbackType;
  body: string;
  reporterUid: string;
  reporterName?: string | null;
  reporterRole: ProjectRole;
  currentPath: string;
  pageLabel: string;
};

export function getFeedbackTypeLabel(type: FeedbackType): string {
  return FEEDBACK_TYPE_DETAILS[type].label;
}

export function getFeedbackStatusLabel(status: FeedbackStatus): string {
  return FEEDBACK_STATUS_LABELS[status];
}

export function getFeedbackPageLabel(path: string): string {
  if (/\/rehearsals\/?$/.test(path)) return "稽古";
  if (/\/production\/venue\/?$/.test(path)) return "会場";
  if (/\/production\/flyer\/?$/.test(path)) return "チラシ・ポスター";
  if (/\/production\/web\/?$/.test(path)) return "Web・SNS";
  if (/\/production\/tickets\/?$/.test(path)) return "チケット";
  if (/\/production\/reception\/?$/.test(path)) return "当日受付";
  if (/\/production\/accounting\/?$/.test(path)) return "会計";
  if (/\/info\/?$/.test(path)) return "公演情報";
  if (/\/activity\/?$/.test(path)) return "更新履歴";
  if (/\/people\/?$/.test(path)) return "関係者管理";
  if (/\/members\/?$/.test(path)) return "メンバー管理";
  if (/\/tasks\/?$/.test(path)) return "タスク一覧";
  if (/\/feedback\/?$/.test(path)) return "フィードバック";
  if (/\/projects\/[^/]+\/?$/.test(path)) return "公演トップ";
  return "公演内ページ";
}

export function normalizeFeedbackSourcePath(projectId: string, path: string | undefined): string {
  const fallback = `/projects/${projectId}/feedback`;
  if (!path) return fallback;
  const pathOnly = path.split(/[?#]/, 1)[0];
  const projectRoot = `/projects/${projectId}`;
  return pathOnly === projectRoot || pathOnly.startsWith(`${projectRoot}/`) ? pathOnly : fallback;
}

export function normalizeFeedbackBody(body: string): string {
  return body.trim();
}

export function buildFeedbackPayload<TimestampValue>(
  input: FeedbackCreateInput,
  timestamp: TimestampValue
) {
  const body = normalizeFeedbackBody(input.body);
  if (!body) throw new Error("フィードバック内容を入力してください");

  return {
    type: input.type,
    body,
    status: "unreviewed" as const,
    reporterUid: input.reporterUid,
    reporterName: input.reporterName?.trim() || "名前未設定のユーザー",
    reporterRole: input.reporterRole,
    currentPath: input.currentPath,
    pageLabel: input.pageLabel,
    adminNote: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
