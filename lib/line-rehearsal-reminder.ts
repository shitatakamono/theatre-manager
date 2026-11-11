import { createHash } from "node:crypto";

export const LINE_REHEARSAL_REMINDER_TYPE = "rehearsal_day_before" as const;
export const LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS = 3;
export const LINE_REHEARSAL_REMINDER_TIME_ZONE = "Asia/Tokyo";

export type ReminderRehearsal = {
  id: string;
  startAtMillis: number;
  endAtMillis: number | null;
  typeLabel: string;
  venue: string;
  cancelled: boolean;
};

export type ReminderPerson = {
  id: string;
  displayName: string;
  linkedUserUid: string | null;
  active: boolean;
  attendanceTarget: boolean;
};

export type ReminderAttendance = {
  participantId: string;
  status: "attending" | "absent" | "tentative";
  availableFrom: string | null;
  availableUntil: string | null;
};

export type ReminderAttendanceSummary = {
  attending: string[];
  late: string[];
  early: string[];
  lateAndEarly: string[];
};

function tokyoParts(value: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LINE_REHEARSAL_REMINDER_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

export function getTokyoDate(value = new Date()): string {
  const { year, month, day } = tokyoParts(value);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getNextTokyoDate(value = new Date()): string {
  const { year, month, day } = tokyoParts(value);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}

export function getTokyoDateRange(date: string): { startMillis: number; endMillis: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("invalid_rehearsal_date");
  const startMillis = new Date(`${date}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(startMillis)) throw new Error("invalid_rehearsal_date");
  return { startMillis, endMillis: startMillis + 24 * 60 * 60 * 1000 };
}

export function isLineReminderScheduleTime(value: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LINE_REHEARSAL_REMINDER_TIME_ZONE,
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return map.hour === "12" && map.minute === "00";
}

export function activeReminderRehearsals(items: readonly ReminderRehearsal[]): ReminderRehearsal[] {
  return items.filter((item) => !item.cancelled)
    .sort((left, right) => left.startAtMillis - right.startAtMillis || left.id.localeCompare(right.id));
}

export function uniqueReminderRecipients(people: readonly ReminderPerson[]): string[] {
  return [...new Set(people.filter((person) => person.active && person.linkedUserUid)
    .map((person) => person.linkedUserUid!))].sort();
}

function timeInTokyo(millis: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: LINE_REHEARSAL_REMINDER_TIME_ZONE,
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(millis));
}

function dateLabel(date: string): string {
  const value = new Date(`${date}T12:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: LINE_REHEARSAL_REMINDER_TIME_ZONE,
    month: "long", day: "numeric", weekday: "short",
  }).format(value);
}

export function buildReminderAttendanceSummary(input: {
  people: readonly ReminderPerson[];
  attendance: readonly ReminderAttendance[];
  rehearsals: readonly ReminderRehearsal[];
}): ReminderAttendanceSummary {
  const people = new Map(input.people.filter((person) => person.active && person.attendanceTarget)
    .map((person) => [person.id, person]));
  const starts = input.rehearsals.map((item) => timeInTokyo(item.startAtMillis));
  const ends = input.rehearsals.flatMap((item) => item.endAtMillis === null ? [] : [timeInTokyo(item.endAtMillis)]);
  const dayStart = starts.sort()[0] ?? null;
  const dayEnd = ends.sort().at(-1) ?? null;
  const summary: ReminderAttendanceSummary = { attending: [], late: [], early: [], lateAndEarly: [] };
  for (const record of input.attendance) {
    const person = people.get(record.participantId);
    if (!person || record.status !== "attending") continue;
    const late = Boolean(dayStart && record.availableFrom && record.availableFrom > dayStart);
    const early = Boolean(dayEnd && record.availableUntil && record.availableUntil < dayEnd);
    if (late && early) {
      summary.lateAndEarly.push(`${person.displayName}（${record.availableFrom}頃から／${record.availableUntil}頃まで）`);
    } else if (late) {
      summary.late.push(`${person.displayName}（${record.availableFrom}頃から）`);
    } else if (early) {
      summary.early.push(`${person.displayName}（${record.availableUntil}頃まで）`);
    } else {
      summary.attending.push(person.displayName);
    }
  }
  for (const values of Object.values(summary)) values.sort((left, right) => left.localeCompare(right, "ja"));
  return summary;
}

function section(title: string, values: readonly string[]): string {
  return `${title}：\n${values.length ? values.map((value) => `・${value}`).join("\n") : "・なし"}`;
}

export function buildLineRehearsalReminderMessage(input: {
  date: string;
  rehearsals: readonly ReminderRehearsal[];
  attendance: ReminderAttendanceSummary;
}): string {
  const rehearsals = activeReminderRehearsals(input.rehearsals);
  if (!rehearsals.length) throw new Error("no_active_rehearsals");
  const schedule = rehearsals.map((item) => {
    const time = `${timeInTokyo(item.startAtMillis)}〜${item.endAtMillis === null ? "終了未設定" : timeInTokyo(item.endAtMillis)}`;
    return `■ ${item.typeLabel}\n${time}\n${item.venue || "会場未設定"}`;
  }).join("\n\n");
  return [
    "明日の稽古のお知らせ",
    dateLabel(input.date),
    schedule,
    section("出席予定", input.attendance.attending),
    section("遅刻", input.attendance.late),
    section("早退", input.attendance.early),
    section("遅刻・早退", input.attendance.lateAndEarly),
    "SeisakuBoardで最新情報をご確認ください。",
  ].join("\n\n");
}

export function buildLineReminderDeliveryId(projectId: string, date: string, recipientUid: string): string {
  return createHash("sha256")
    .update(`${LINE_REHEARSAL_REMINDER_TYPE}:${projectId}:${date}:${recipientUid}`)
    .digest("base64url");
}

export function classifyLineReminderFailure(code: string, attemptCount: number): "failed_retryable" | "failed_permanent" {
  const retryable = new Set(["line_rate_limited", "line_server_error", "line_network_error"]);
  return retryable.has(code) && attemptCount < LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS
    ? "failed_retryable"
    : "failed_permanent";
}
