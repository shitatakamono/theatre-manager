import type { ProjectRole } from "./auth.ts";

export type ProjectNavigationItem = {
  label: string;
  href?: string;
  action?: "help";
};

export type ProjectNavigationModel = {
  primary: Array<Required<Pick<ProjectNavigationItem, "label" | "href">>>;
  management: ProjectNavigationItem[];
};

export function buildProjectNavigation(projectId: string): ProjectNavigationModel {
  const base = `/projects/${projectId}`;
  return {
    primary: [
      { label: "公演トップ", href: base },
      { label: "稽古", href: `${base}/rehearsals` },
      { label: "制作タスク", href: `${base}/tasks` },
    ],
    management: [
      { label: "関係者管理", href: `${base}/people` },
      { label: "システム利用者", href: `${base}/members` },
      { label: "更新履歴", href: `${base}/activity` },
      { label: "使い方", action: "help" as const },
    ],
  };
}

export function buildRehearsalSectionNavigation(projectId: string) {
  const base = `/projects/${projectId}`;
  return [
    { label: "稽古スケジュール", href: `${base}/rehearsals` },
    { label: "自分の出欠", href: `${base}/attendance` },
    { label: "全体出欠", href: `${base}/attendance/manage` },
  ];
}

export function reduceManagementMenuState(current: boolean, action: "toggle" | "close"): boolean {
  return action === "toggle" ? !current : false;
}

export function isManagementMenuVisible(open: boolean, openedPathname: string, currentPathname: string): boolean {
  return open && openedPathname === currentPathname;
}

export function isCurrentProjectNavigationItem(pathname: string, href: string): boolean {
  if (href.includes("#")) return false;
  return pathname === href;
}

export function isCurrentProjectPrimaryNavigationItem(pathname: string, href: string): boolean {
  if (isCurrentProjectNavigationItem(pathname, href)) return true;
  if (!href.endsWith("/rehearsals")) return false;
  const projectBase = href.slice(0, -"/rehearsals".length);
  return pathname === `${projectBase}/attendance` || pathname === `${projectBase}/attendance/manage`;
}

export function getAttendanceManagementAccess(role?: ProjectRole): { canView: boolean; canEdit: boolean } {
  const canView = role === "owner" || role === "editor" || role === "viewer";
  return { canView, canEdit: role === "owner" || role === "editor" };
}

export function getLegacyParticipantRedirectPath(projectId: string): string {
  return `/projects/${projectId}/people`;
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
