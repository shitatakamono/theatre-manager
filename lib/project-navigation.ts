import type { ProjectRole } from "./auth.ts";

export type ProjectNavigationItem = {
  label: string;
  href?: string;
  action?: "help";
  auxiliary?: boolean;
};

export type ProjectNavigationGroup = {
  label: "公演" | "稽古" | "制作" | "管理";
  items: ProjectNavigationItem[];
};

export function buildProjectNavigation(projectId: string, role?: ProjectRole): ProjectNavigationGroup[] {
  const base = `/projects/${projectId}`;
  const canEdit = role === "owner" || role === "editor";
  const canManageMembers = role === "owner";
  return [
    { label: "公演", items: [
      { label: "公演トップ", href: base },
      { label: "公演情報", href: `${base}/info` },
    ] },
    { label: "稽古", items: [
      { label: "稽古スケジュール", href: `${base}/rehearsals` },
      { label: "出欠入力", href: `${base}/attendance` },
      { label: "全体出欠", href: `${base}/attendance/manage` },
    ] },
    { label: "制作", items: [
      { label: "制作ロードマップ", href: `${base}#production-roadmap` },
      { label: "タスク一覧（開発中）", href: `${base}/tasks` },
    ] },
    { label: "管理", items: [
      ...(canManageMembers ? [{ label: "システム利用者", href: `${base}/members` }] : []),
      { label: "更新履歴", href: `${base}/activity` },
      ...(canEdit ? [{ label: "参加者管理（補助）", href: `${base}/participants`, auxiliary: true }] : []),
      { label: "使い方", action: "help" as const },
    ] },
  ];
}

export function isCurrentProjectNavigationItem(pathname: string, href: string): boolean {
  if (href.includes("#")) return false;
  return pathname === href;
}

export function getAttendanceManagementAccess(role?: ProjectRole): { canView: boolean; canEdit: boolean } {
  const canView = role === "owner" || role === "editor" || role === "viewer";
  return { canView, canEdit: role === "owner" || role === "editor" };
}

export type PerformanceHeaderInput = {
  organizer?: string;
  performanceName?: string;
  title?: string;
  venueName?: string;
  hasPerformanceDate: boolean;
};

export function hasEnteredPerformanceInformation(input: PerformanceHeaderInput): boolean {
  return Boolean(
    input.organizer?.trim()
    && (input.performanceName?.trim() || input.title?.trim())
    && input.venueName?.trim()
    && input.hasPerformanceDate
  );
}
