import { createHash } from "node:crypto";

export const LINE_REHEARSAL_REMINDER_TYPE = "rehearsal_day_before" as const;
export const LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS = 3;
export const LINE_REHEARSAL_REMINDER_TIME_ZONE = "Asia/Tokyo";
export const LINE_TEXT_MESSAGE_MAX_LENGTH = 5000;

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
  absent: string[];
  tentative: string[];
  unanswered: string[];
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
  const attendance = new Map(input.attendance.map((record) => [record.participantId, record]));
  const summary: ReminderAttendanceSummary = {
    attending: [], late: [], early: [], lateAndEarly: [],
    absent: [], tentative: [], unanswered: [],
  };
  for (const person of people.values()) {
    const record = attendance.get(person.id);
    if (!record) {
      summary.unanswered.push(person.displayName);
      continue;
    }
    if (record.status === "absent") {
      summary.absent.push(person.displayName);
      continue;
    }
    if (record.status === "tentative") {
      summary.tentative.push(person.displayName);
      continue;
    }
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

type NamedSection = { title: string; values: readonly string[] };

const ATTENDANCE_GUIDANCE = "出欠は当日全体の予定です（部門別ではありません）。";
const MESSAGE_FOOTER = "SeisakuBoardで最新の稽古予定と出欠をご確認ください。";

function truncateUtf16(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  let result = "";
  for (const character of value) {
    if ((result + character + "…").length > maxLength) break;
    result += character;
  }
  return `${result}…`;
}

function scheduleBlock(item: ReminderRehearsal, compact = false): string {
  const time = `${timeInTokyo(item.startAtMillis)}〜${item.endAtMillis === null ? "終了未設定" : timeInTokyo(item.endAtMillis)}`;
  const typeLabel = compact ? truncateUtf16(item.typeLabel, 48) : item.typeLabel;
  const venue = compact ? truncateUtf16(item.venue || "会場未設定", 96) : item.venue || "会場未設定";
  return `■ ${typeLabel}\n${time}\n${venue}`;
}

function namedSection(section: NamedSection, shownCount: number): string {
  if (!section.values.length) return `${section.title}：\n・なし`;
  const shown = section.values.slice(0, shownCount).map((value) => `・${value}`);
  const omitted = section.values.length - shownCount;
  if (omitted > 0) shown.push(`・ほか${omitted}名`);
  return `${section.title}：\n${shown.join("\n")}`;
}

function joinMessageParts(parts: readonly string[]): string {
  return parts.join("\n\n");
}

function buildScheduleForMessage(input: {
  prefix: readonly string[];
  rehearsals: readonly ReminderRehearsal[];
  minimalTail: readonly string[];
}): string {
  const full = input.rehearsals.map((item) => scheduleBlock(item)).join("\n\n");
  if (joinMessageParts([...input.prefix, full, ...input.minimalTail]).length <= LINE_TEXT_MESSAGE_MAX_LENGTH) {
    return full;
  }

  const blocks = input.rehearsals.map((item) => scheduleBlock(item, true));
  const included: string[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const remaining = blocks.length - (index + 1);
    const candidate = [...included, blocks[index]];
    if (remaining > 0) candidate.push(`■ ほか${remaining}件の稽古枠があります`);
    if (joinMessageParts([...input.prefix, candidate.join("\n\n"), ...input.minimalTail]).length
      > LINE_TEXT_MESSAGE_MAX_LENGTH) break;
    included.push(blocks[index]);
  }
  const omitted = blocks.length - included.length;
  if (omitted > 0) included.push(`■ ほか${omitted}件の稽古枠があります`);
  return included.join("\n\n");
}

export function buildLineRehearsalReminderMessage(input: {
  date: string;
  rehearsals: readonly ReminderRehearsal[];
  attendance: ReminderAttendanceSummary;
}): string {
  const rehearsals = activeReminderRehearsals(input.rehearsals);
  if (!rehearsals.length) throw new Error("no_active_rehearsals");
  const prefix = ["明日の稽古のお知らせ", dateLabel(input.date)];
  const sections: NamedSection[] = [
    { title: "出席予定", values: input.attendance.attending },
    { title: "遅刻", values: input.attendance.late },
    { title: "早退", values: input.attendance.early },
    { title: "遅刻・早退", values: input.attendance.lateAndEarly },
    { title: "欠席", values: input.attendance.absent },
    { title: "未定", values: input.attendance.tentative },
    { title: "未回答", values: input.attendance.unanswered },
  ].filter((section) => section.values.length > 0);
  const minimalSections = sections.map((item) => namedSection(item, 0));
  const minimalTail = [ATTENDANCE_GUIDANCE, ...minimalSections, MESSAGE_FOOTER];
  const schedule = buildScheduleForMessage({ prefix, rehearsals, minimalTail });
  const renderedSections: string[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    const remaining = sections.slice(index + 1).map((item) => namedSection(item, 0));
    let rendered = namedSection(sections[index], 0);
    for (let count = 1; count <= sections[index].values.length; count += 1) {
      const candidate = namedSection(sections[index], count);
      const message = joinMessageParts([
        ...prefix, schedule, ATTENDANCE_GUIDANCE,
        ...renderedSections, candidate, ...remaining, MESSAGE_FOOTER,
      ]);
      if (message.length > LINE_TEXT_MESSAGE_MAX_LENGTH) break;
      rendered = candidate;
    }
    renderedSections.push(rendered);
  }
  const message = joinMessageParts([
    ...prefix, schedule, ATTENDANCE_GUIDANCE, ...renderedSections, MESSAGE_FOOTER,
  ]);
  return message.length <= LINE_TEXT_MESSAGE_MAX_LENGTH
    ? message
    : truncateUtf16(message, LINE_TEXT_MESSAGE_MAX_LENGTH);
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
