import { createHash } from "node:crypto";

export const LINE_REHEARSAL_CHANGE_TYPE = "rehearsal_schedule_changed" as const;
export const LINE_REHEARSAL_CHANGE_TIME_ZONE = "Asia/Tokyo";
export const LINE_TEXT_MAX_CODE_UNITS = 5000;

export type RehearsalChangeSnapshot = {
  startAtMillis: number;
  endAtMillis: number | null;
  typeLabel: string;
  venue: string;
  content: string;
  note: string;
  cancelled: boolean;
};

export type RehearsalChangeEvent = {
  id: string;
  projectId: string;
  rehearsalId: string;
  eventType: "created" | "updated" | "deleted";
  before: RehearsalChangeSnapshot | null;
  after: RehearsalChangeSnapshot | null;
  occurredAtMillis: number;
};

export type AggregatedRehearsalChange = {
  rehearsalId: string;
  eventIds: string[];
  before: RehearsalChangeSnapshot | null;
  after: RehearsalChangeSnapshot | null;
};

function millis(value: unknown): number | null {
  if (value && typeof value === "object" && "toMillis" in value
    && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    const result = (value as { toMillis(): number }).toMillis();
    return Number.isFinite(result) ? result : null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function label(data: Record<string, unknown>): string {
  const type = data.type;
  if (type === "acting" || type === "reading" || type === "run_through") return "芝居";
  if (type === "stage_combat") return "殺陣";
  if (type === "japanese_dance") return "日舞";
  if (type === "meeting") return "打ち合わせ";
  return typeof data.customType === "string" && data.customType.trim() ? data.customType.trim() : "その他";
}

export function extractRehearsalChangeSnapshot(data: Record<string, unknown> | undefined): RehearsalChangeSnapshot | null {
  if (!data) return null;
  const startAtMillis = millis(data.startAt);
  if (startAtMillis === null) return null;
  return {
    startAtMillis,
    endAtMillis: millis(data.endAt),
    typeLabel: label(data),
    venue: typeof data.venue === "string" ? data.venue.trim() : "",
    content: typeof data.content === "string" ? data.content.trim() : "",
    note: typeof data.note === "string" ? data.note.trim() : "",
    cancelled: data.cancelled === true || data.status === "cancelled",
  };
}

export function sameRehearsalChangeSnapshot(left: RehearsalChangeSnapshot | null, right: RehearsalChangeSnapshot | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getTokyoDayStartMillis(value: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LINE_REHEARSAL_CHANGE_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(`${map.year}-${map.month}-${map.day}T00:00:00+09:00`).getTime();
}

export function shouldRecordRehearsalChange(input: {
  before: RehearsalChangeSnapshot | null;
  after: RehearsalChangeSnapshot | null;
  occurredAtMillis: number;
}): boolean {
  if (sameRehearsalChangeSnapshot(input.before, input.after)) return false;
  const relevant = input.after ?? input.before;
  return relevant !== null && relevant.startAtMillis >= getTokyoDayStartMillis(new Date(input.occurredAtMillis));
}

export function getRehearsalChangeBatchWindow(input: {
  cutoff: Date;
  slot: "12" | "20";
}): { startExclusiveMillis: number; endInclusiveMillis: number; key: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: LINE_REHEARSAL_CHANGE_TIME_ZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(input.cutoff);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${map.year}-${map.month}-${map.day}`;
  const endInclusiveMillis = new Date(`${date}T${input.slot}:00:00+09:00`).getTime();
  const startExclusiveMillis = input.slot === "20"
    ? new Date(`${date}T12:00:00+09:00`).getTime()
    : endInclusiveMillis - 16 * 60 * 60 * 1000;
  return { startExclusiveMillis, endInclusiveMillis, key: `${date}T${input.slot}:00+09:00` };
}

export function aggregateRehearsalChangeEvents(events: readonly RehearsalChangeEvent[]): AggregatedRehearsalChange[] {
  const grouped = new Map<string, RehearsalChangeEvent[]>();
  for (const event of events) grouped.set(event.rehearsalId, [...(grouped.get(event.rehearsalId) ?? []), event]);
  return [...grouped.entries()].flatMap(([rehearsalId, items]) => {
    const sorted = [...items].sort((a, b) => a.occurredAtMillis - b.occurredAtMillis || a.id.localeCompare(b.id));
    const before = sorted[0].before;
    const after = sorted.at(-1)!.after;
    if (sameRehearsalChangeSnapshot(before, after) || (before === null && after === null)) return [];
    return [{ rehearsalId, eventIds: sorted.map(({ id }) => id), before, after }];
  }).sort((a, b) => (a.after ?? a.before)!.startAtMillis - (b.after ?? b.before)!.startAtMillis || a.rehearsalId.localeCompare(b.rehearsalId));
}

function date(value: number): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: LINE_REHEARSAL_CHANGE_TIME_ZONE, month: "long", day: "numeric", weekday: "short" }).format(new Date(value));
}

function time(value: number): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: LINE_REHEARSAL_CHANGE_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

function schedule(item: RehearsalChangeSnapshot): string[] {
  return [date(item.startAtMillis), `${time(item.startAtMillis)}〜${item.endAtMillis === null ? "終了時刻未定" : time(item.endAtMillis)}`, item.typeLabel, item.venue || "会場未定"];
}

function changeBlock(change: AggregatedRehearsalChange): string {
  if (!change.before && change.after) return [`■ ${date(change.after.startAtMillis)} ${change.after.typeLabel}`, ...schedule(change.after), "新しい稽古予定が追加されました。"].join("\n");
  if (change.before && !change.after) return [`■ ${date(change.before.startAtMillis)} ${change.before.typeLabel}`, ...schedule(change.before), "この稽古予定は削除されました。"].join("\n");
  const before = change.before!; const after = change.after!;
  if (!before.cancelled && after.cancelled) return [`■ ${date(after.startAtMillis)} ${after.typeLabel}`, ...schedule(after), "この稽古は中止になりました。"].join("\n");
  const blocks = [`■ ${date(after.startAtMillis)} ${after.typeLabel}`];
  if (before.startAtMillis !== after.startAtMillis || before.endAtMillis !== after.endAtMillis) {
    const dateChanged = date(before.startAtMillis) !== date(after.startAtMillis);
    blocks.push(dateChanged ? "【日程変更】" : "【時間変更】", ...schedule(before).slice(0, 2), "↓", ...schedule(after).slice(0, 2));
  }
  if (before.typeLabel !== after.typeLabel) blocks.push("【種別変更】", before.typeLabel, "↓", after.typeLabel);
  if (before.venue !== after.venue) blocks.push("【会場変更】", before.venue || "会場未定", "↓", after.venue || "会場未定");
  if (before.content !== after.content) blocks.push("【内容変更】", before.content || "記載なし", "↓", after.content || "記載なし");
  if (before.note !== after.note) blocks.push("【備考変更】", before.note || "記載なし", "↓", after.note || "記載なし");
  if (before.cancelled && !after.cancelled) blocks.push("【中止解除】", "この稽古は実施予定に戻りました。");
  return blocks.join("\n");
}

export function buildRehearsalChangeMessages(changes: readonly AggregatedRehearsalChange[]): string[] {
  if (!changes.length) return [];
  const header = "稽古予定変更のお知らせ";
  const footer = "SeisakuBoardで最新情報をご確認ください。";
  let current = header;
  for (const change of changes) {
    const block = changeBlock(change);
    const candidate = `${current}\n\n${block}\n\n${footer}`;
    if (candidate.length <= LINE_TEXT_MAX_CODE_UNITS) {
      current = `${current}\n\n${block}`;
      continue;
    }
    // One delivery maps to one LINE API request and one retry key. Falling
    // back to a compact summary avoids partial multi-request deliveries.
    return [`${header}\n\n${changes.length}件の稽古予定が更新されました。\n変更内容が多いため、SeisakuBoardで最新情報をご確認ください。`];
  }
  return [`${current}\n\n${footer}`];
}

export function buildRehearsalChangeDeliveryId(batchId: string, recipientUid: string): string {
  return createHash("sha256").update(`${LINE_REHEARSAL_CHANGE_TYPE}:${batchId}:${recipientUid}`).digest("base64url");
}

export function buildRehearsalChangeBatchId(projectId: string, windowKey: string): string {
  return createHash("sha256").update(`${LINE_REHEARSAL_CHANGE_TYPE}:${projectId}:${windowKey}`).digest("base64url");
}

export function canSuppressWithDayBeforeDelivery(input: {
  allAffectedDates: readonly string[];
  tomorrowDate: string;
  dayBeforeDeliverySent: boolean;
}): boolean {
  return input.dayBeforeDeliverySent
    && input.allAffectedDates.length > 0
    && input.allAffectedDates.every((value) => value === input.tomorrowDate);
}
