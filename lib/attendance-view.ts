import type { AttendanceInput, AttendanceRecord, AttendanceStatus } from "./attendance.ts";
import type { Participant } from "./participants.ts";
import {
  getRehearsalTypeLabel,
  timestampToTokyoInput,
  type Rehearsal,
} from "./rehearsals.ts";

export type AttendanceDraft = {
  status: AttendanceStatus | null;
  availableFrom: string | null;
  availableUntil: string | null;
  publicNote: string;
};

export type RehearsalDaySummary = {
  date: string;
  rehearsals: Rehearsal[];
  fullTimeRange: { from: string; until: string } | null;
};

export type SharedAttendanceRow = {
  participant: Participant;
  record: AttendanceRecord | null;
};

export function todayInTokyo(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getFullDayTimeRange(rehearsals: readonly Rehearsal[]): { from: string; until: string } | null {
  if (rehearsals.length === 0 || rehearsals.some((rehearsal) => rehearsal.endAt === null)) return null;
  const starts = rehearsals.map((rehearsal) => rehearsal.startAt.toMillis());
  const ends = rehearsals.map((rehearsal) => rehearsal.endAt?.toMillis() ?? Number.NaN);
  const earliest = rehearsals[starts.indexOf(Math.min(...starts))];
  const latest = rehearsals[ends.indexOf(Math.max(...ends))];
  if (!latest.endAt) return null;
  const start = timestampToTokyoInput(earliest.startAt);
  const end = timestampToTokyoInput(latest.endAt);
  if (start.date !== end.date || start.time >= end.time) return null;
  return { from: start.time, until: end.time };
}

export function buildFutureRehearsalDays(rehearsals: readonly Rehearsal[], now = new Date()): RehearsalDaySummary[] {
  const today = todayInTokyo(now);
  const byDate = new Map<string, Rehearsal[]>();
  rehearsals.forEach((rehearsal) => {
    const date = timestampToTokyoInput(rehearsal.startAt).date;
    if (date < today) return;
    const items = byDate.get(date) ?? [];
    items.push(rehearsal);
    byDate.set(date, items);
  });
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, items]) => {
      const sorted = [...items].sort((left, right) => left.startAt.toMillis() - right.startAt.toMillis());
      return { date, rehearsals: sorted, fullTimeRange: getFullDayTimeRange(sorted) };
    });
}

export function formatRehearsalDayItem(rehearsal: Rehearsal): string {
  const start = timestampToTokyoInput(rehearsal.startAt).time;
  const end = rehearsal.endAt ? timestampToTokyoInput(rehearsal.endAt).time : "終了未設定";
  return `${getRehearsalTypeLabel(rehearsal.type, rehearsal.customType)} ${start}〜${end}`;
}

export function findSelfParticipant<T extends Pick<Participant, "linkedUserUid">>(participants: readonly T[], uid: string): T | null {
  return participants.find((participant) => participant.linkedUserUid === uid) ?? null;
}

export function buildAttendanceDrafts(
  days: readonly Pick<RehearsalDaySummary, "date">[],
  participantId: string,
  records: readonly AttendanceRecord[]
): Record<string, AttendanceDraft> {
  const recordByDate = new Map(records
    .filter((record) => record.participantId === participantId)
    .map((record) => [record.date, record]));
  return Object.fromEntries(days.map(({ date }) => {
    const record = recordByDate.get(date);
    return [date, record ? {
      status: record.status,
      availableFrom: record.availableFrom,
      availableUntil: record.availableUntil,
      publicNote: record.publicNote,
    } : {
      status: null,
      availableFrom: null,
      availableUntil: null,
      publicNote: "",
    }];
  }));
}

function sameRecord(record: AttendanceRecord | undefined, draft: AttendanceDraft): boolean {
  return Boolean(record)
    && record?.status === draft.status
    && record.availableFrom === draft.availableFrom
    && record.availableUntil === draft.availableUntil
    && record.publicNote === draft.publicNote.trim();
}

export function getChangedAttendanceInputs(
  days: readonly Pick<RehearsalDaySummary, "date">[],
  participantId: string,
  drafts: Readonly<Record<string, AttendanceDraft>>,
  records: readonly AttendanceRecord[]
): AttendanceInput[] {
  const recordByDate = new Map(records
    .filter((record) => record.participantId === participantId)
    .map((record) => [record.date, record]));
  return days.flatMap(({ date }) => {
    const draft = drafts[date];
    if (!draft || draft.status === null || sameRecord(recordByDate.get(date), draft)) return [];
    return [{
      participantId,
      date,
      status: draft.status,
      availableFrom: draft.status === "attending" ? draft.availableFrom : null,
      availableUntil: draft.status === "attending" ? draft.availableUntil : null,
      publicNote: draft.publicNote,
    }];
  });
}

export function buildSharedAttendanceRows(
  date: string,
  participants: readonly Participant[],
  records: readonly AttendanceRecord[]
): SharedAttendanceRow[] {
  const recordByParticipant = new Map(records
    .filter((record) => record.date === date)
    .map((record) => [record.participantId, record]));
  return participants
    .filter((participant) => participant.active)
    .map((participant) => ({ participant, record: recordByParticipant.get(participant.id) ?? null }))
    .sort((left, right) => left.participant.displayName.localeCompare(right.participant.displayName, "ja"));
}
