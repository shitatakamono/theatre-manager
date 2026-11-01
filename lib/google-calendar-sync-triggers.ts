export type GoogleCalendarTriggerAudience = "normal" | "mapping_owners";

export type GoogleCalendarTriggerPlan = {
  audience: GoogleCalendarTriggerAudience;
  reason: string;
};

export type GoogleCalendarFanoutResult = {
  requestedCount: number;
  enqueuedCount: number;
  failedCount: number;
  errorCodes: string[];
};

type UnknownRecord = Record<string, unknown>;

const GOOGLE_CALENDAR_SYNC_TRIGGER_REASONS = {
  REHEARSAL_CREATED: "rehearsal_created",
  REHEARSAL_UPDATED: "rehearsal_updated",
  REHEARSAL_DELETED: "rehearsal_deleted",
  PERSON_CHANGED: "person_changed",
  PARTICIPATION_CHANGED: "participation_changed",
  LINK_CHANGED: "link_changed",
} as const;

const REHEARSAL_FIELDS = [
  "startAt",
  "endAt",
  "type",
  "customType",
  "venue",
  "content",
  "note",
] as const;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { toMillis?: unknown };
  if (typeof candidate.toMillis !== "function") return null;
  try {
    const millis = candidate.toMillis();
    return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
  } catch {
    return null;
  }
}

function canonicalize(value: unknown): unknown {
  const millis = timestampMillis(value);
  if (millis !== null) return { timestampMillis: millis };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value ?? null;
  return Object.fromEntries(
    Object.entries(value as UnknownRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)])
  );
}

function equalCanonical(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function performancePersonIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return sortedUnique(value.flatMap((entry) => {
    const personId = normalizedString(record(entry).personId);
    return personId ? [personId] : [];
  }));
}

function staffPersonIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return sortedUnique(value.flatMap((role) => {
    const members = record(role).members;
    return Array.isArray(members) ? performancePersonIds(members) : [];
  }));
}

export function didGoogleCalendarRelevantRehearsalFieldsChange(
  before: unknown,
  after: unknown
): boolean {
  const beforeRecord = record(before);
  const afterRecord = record(after);
  return REHEARSAL_FIELDS.some((field) =>
    !equalCanonical(beforeRecord[field], afterRecord[field]));
}

export function didGoogleCalendarParticipationFieldsChange(
  before: unknown,
  after: unknown
): boolean {
  const beforeRecord = record(before);
  const afterRecord = record(after);
  return !equalCanonical(
    beforeRecord.rehearsalParticipationTypes,
    afterRecord.rehearsalParticipationTypes
  ) || beforeRecord.active !== afterRecord.active;
}

export function didGoogleCalendarPersonLinkChange(
  before: unknown,
  after: unknown
): boolean {
  return normalizedString(record(before).linkedUserUid)
    !== normalizedString(record(after).linkedUserUid);
}

export function getGoogleCalendarLinkedUid(value: unknown): string | null {
  const uid = normalizedString(record(value).linkedUserUid);
  return uid || null;
}

export function didProjectCastStaffEligibilityChange(
  before: unknown,
  after: unknown
): boolean {
  const beforeRecord = record(before);
  const afterRecord = record(after);
  return !equalCanonical(
    performancePersonIds(beforeRecord.cast),
    performancePersonIds(afterRecord.cast)
  ) || !equalCanonical(
    staffPersonIds(beforeRecord.staff),
    staffPersonIds(afterRecord.staff)
  );
}

export function planGoogleCalendarRehearsalTrigger(
  change: "create" | "update" | "delete",
  before?: unknown,
  after?: unknown
): GoogleCalendarTriggerPlan | null {
  if (change === "create") {
    return {
      audience: "normal",
      reason: GOOGLE_CALENDAR_SYNC_TRIGGER_REASONS.REHEARSAL_CREATED,
    };
  }
  if (change === "delete") {
    return {
      audience: "mapping_owners",
      reason: GOOGLE_CALENDAR_SYNC_TRIGGER_REASONS.REHEARSAL_DELETED,
    };
  }
  return didGoogleCalendarRelevantRehearsalFieldsChange(before, after)
    ? {
        audience: "normal",
        reason: GOOGLE_CALENDAR_SYNC_TRIGGER_REASONS.REHEARSAL_UPDATED,
      }
    : null;
}

export function planGoogleCalendarPersonTriggers(
  before: unknown,
  after: unknown
): Array<{ uid: string; reason: string }> {
  if (!after) return [];
  const uid = getGoogleCalendarLinkedUid(after);
  if (!uid) return [];

  const reasons: string[] = [];
  if (didGoogleCalendarParticipationFieldsChange(before, after)) {
    reasons.push(GOOGLE_CALENDAR_SYNC_TRIGGER_REASONS.PARTICIPATION_CHANGED);
  }
  if (didGoogleCalendarPersonLinkChange(before, after)) {
    reasons.push(GOOGLE_CALENDAR_SYNC_TRIGGER_REASONS.PERSON_CHANGED);
  }
  return sortedUnique(reasons).map((reason) => ({ uid, reason }));
}

export function planGoogleCalendarLinkedUserTrigger(input: {
  uid: string;
  beforeParticipantId?: unknown;
  afterParticipantId?: unknown;
}): Array<{ uid: string; reason: string }> {
  const uid = input.uid.trim();
  const beforeParticipantId = normalizedString(input.beforeParticipantId);
  const afterParticipantId = normalizedString(input.afterParticipantId);
  if (!uid || !afterParticipantId || beforeParticipantId === afterParticipantId) {
    return [];
  }
  return [{
    uid,
    reason: GOOGLE_CALENDAR_SYNC_TRIGGER_REASONS.LINK_CHANGED,
  }];
}

export async function enqueueGoogleCalendarSyncForUids(input: {
  projectId: string;
  uids: Iterable<string>;
  reason: string;
  enqueue: (request: {
    uid: string;
    projectId: string;
    reason: string;
  }) => Promise<unknown>;
}): Promise<GoogleCalendarFanoutResult> {
  const projectId = input.projectId.trim();
  const reason = input.reason.trim();
  if (!projectId || !reason) throw new Error("projectId and reason are required");

  const uids = sortedUnique(input.uids);
  let enqueuedCount = 0;
  let failedCount = 0;
  for (const uid of uids) {
    try {
      await input.enqueue({ uid, projectId, reason });
      enqueuedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return {
    requestedCount: uids.length,
    enqueuedCount,
    failedCount,
    errorCodes: failedCount > 0 ? ["sync_job_enqueue_failed"] : [],
  };
}
