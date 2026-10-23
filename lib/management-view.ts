import type { ActivityLog } from "./activity.ts";
import type { ProjectRole } from "./auth.ts";

export const PERFORMANCE_INFORMATION_SECTIONS = [
  { id: "basic", label: "基本情報" },
  { id: "venue", label: "公演日・会場" },
  { id: "tickets", label: "料金" },
  { id: "cast", label: "キャスト" },
  { id: "staff", label: "スタッフ" },
  { id: "credits", label: "協賛・協力等" },
  { id: "schedule", label: "タイムスケジュール" },
  { id: "access", label: "交通アクセス" },
] as const;

export const SYSTEM_ROLE_LABELS: Record<ProjectRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

export function formatInformationValue(value?: string | number): string {
  return value === undefined || value === "" ? "未入力" : String(value);
}

export function getSystemUserStatus(): "有効" {
  return "有効";
}

export function getActivityCategories(logs: readonly ActivityLog[]): string[] {
  return [...new Set(logs.map((log) => log.sectionLabel).filter(Boolean))].sort((left, right) => left.localeCompare(right, "ja"));
}

export function filterActivityLogs(
  logs: readonly ActivityLog[],
  category: string,
  date: string,
): ActivityLog[] {
  return logs.filter((log) => {
    if (category && log.sectionLabel !== category) return false;
    if (!date) return true;
    if (!log.createdAt || typeof log.createdAt !== "object" || !("toDate" in log.createdAt)) return false;
    const toDate = (log.createdAt as { toDate?: unknown }).toDate;
    if (typeof toDate !== "function") return false;
    const created = toDate.call(log.createdAt) as Date;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(created);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}` === date;
  });
}
