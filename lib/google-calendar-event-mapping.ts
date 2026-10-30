import { createHash } from "node:crypto";

export type GoogleCalendarRehearsalSource = {
  startAt: DateTimeLike;
  endAt: DateTimeLike | null;
  categoryId: string;
  customType: string;
  venue: string;
  content: string;
  note: string;
};

export type DateTimeLike =
  | string
  | number
  | Date
  | { toDate(): Date };

export const GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS = 5 * 60 * 1000;

export type GoogleCalendarEventLeaseState =
  | { status: "synced" }
  | { status: "creating"; operationId: string; startedAtMillis: number }
  | null;

export type GoogleCalendarEventLeaseDecision =
  | "acquire"
  | "synced"
  | "in_progress";

export function decideGoogleCalendarEventLease(
  state: GoogleCalendarEventLeaseState,
  nowMillis: number,
  staleMilliseconds = GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS
): GoogleCalendarEventLeaseDecision {
  if (state?.status === "synced") return "synced";
  if (
    state?.status === "creating"
    && nowMillis - state.startedAtMillis < staleMilliseconds
  ) {
    return "in_progress";
  }
  return "acquire";
}

export function ownsGoogleCalendarEventLease(
  state: GoogleCalendarEventLeaseState,
  operationId: string
): boolean {
  return state?.status === "creating" && state.operationId === operationId;
}

function requireIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function canonicalDateTime(value: DateTimeLike): string {
  const date = value instanceof Date
    ? value
    : typeof value === "object"
      ? value.toDate()
      : new Date(value);

  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error("Invalid rehearsal date time");
  }

  return date.toISOString();
}

export function buildGoogleCalendarEventMappingId(
  projectId: string,
  rehearsalId: string
): string {
  const project = requireIdentifier(projectId, "projectId");
  const rehearsal = requireIdentifier(rehearsalId, "rehearsalId");
  const canonicalKey = `${project.length}:${project}${rehearsal.length}:${rehearsal}`;
  return `rehearsal_${createHash("sha256").update(canonicalKey).digest("base64url")}`;
}

export function buildGoogleCalendarRehearsalSourceHash(
  source: GoogleCalendarRehearsalSource
): string {
  const canonicalSource = JSON.stringify({
    startAt: canonicalDateTime(source.startAt),
    endAt: source.endAt === null ? null : canonicalDateTime(source.endAt),
    categoryId: requireIdentifier(source.categoryId, "categoryId"),
    customType: source.customType,
    venue: source.venue,
    content: source.content,
    note: source.note,
  });

  return createHash("sha256").update(canonicalSource).digest("hex");
}
