const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const SELF_EDIT_LOCK_DAYS = 10;

function parseTokyoDate(date: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("出欠日が不正です");
  const parsed = new Date(`${date}T00:00:00+09:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error("出欠日が不正です");
  const normalized = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(parsed);
  if (normalized !== date) throw new Error("出欠日が不正です");
  return parsed;
}

export function getAttendanceEditDeadline(date: string): Date {
  return new Date(parseTokyoDate(date).getTime() - SELF_EDIT_LOCK_DAYS * DAY_MILLISECONDS);
}

export function getAttendanceLastEditableDate(date: string): string {
  const lastEditableInstant = new Date(getAttendanceEditDeadline(date).getTime() - 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(lastEditableInstant);
}

export function isSelfAttendanceLocked(date: string, now = new Date()): boolean {
  return now.getTime() >= getAttendanceEditDeadline(date).getTime();
}
