import { createHash } from "node:crypto";

export const GOOGLE_CALENDAR_SYNC_JOB_LEASE_STALE_MS = 5 * 60 * 1000;
export const GOOGLE_CALENDAR_SYNC_JOB_MAX_ATTEMPTS = 5;
export const GOOGLE_CALENDAR_SYNC_JOB_RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
] as const;

export const GOOGLE_CALENDAR_SYNC_JOB_REASONS = {
  REHEARSAL_CREATED: "rehearsal_created",
  REHEARSAL_UPDATED: "rehearsal_updated",
  REHEARSAL_DELETED: "rehearsal_deleted",
  PERSON_CHANGED: "person_changed",
  PARTICIPATION_CHANGED: "participation_changed",
  CAST_STAFF_CHANGED: "cast_staff_changed",
  LINK_CHANGED: "link_changed",
  GOOGLE_RECONNECTED: "google_reconnected",
  MANUAL_RETRY: "manual_retry",
} as const;

export type GoogleCalendarSyncJobStatus =
  | "pending"
  | "running"
  | "retry"
  | "succeeded"
  | "failed"
  | "waiting_connection";

// Reasons intentionally remain strings so future change sources can be added
// without a schema migration.
export type GoogleCalendarSyncJobReason = string;

export type GoogleCalendarSyncJobState = {
  uid: string;
  projectId: string;
  status: GoogleCalendarSyncJobStatus;
  reasons: string[];
  generation: number;
  attemptCount: number;
  nextAttemptAtMillis: number | null;
  lastAttemptAtMillis: number | null;
  lastSuccessAtMillis: number | null;
  lastErrorCode: string | null;
  retryNeeded: boolean;
  operationId: string | null;
  leaseStartedAtMillis: number | null;
};

export type GoogleCalendarSyncExecutionResult =
  | { success: true; retryable: false; errorCode: null }
  | { success: false; retryable: boolean; errorCode: string };

const RETRYABLE_SYNC_ERROR_CODES = new Set([
  "network_error",
  "google_rate_limited",
  "google_server_error",
  "firestore_transient",
  "access_token_request_failed",
  "calendar_creation_failed",
  "calendar_lookup_failed",
  "calendar_provisioning_in_progress",
  "calendar_provisioning_lost",
  "connection_lookup_failed",
  "connection_save_failed",
  "event_creation_failed",
  "event_lease_lost",
  "event_lease_lost_cleanup_failed",
  "event_lease_claim_failed",
  "event_lease_release_failed",
  "event_delete_lease_claim_failed",
  "event_delete_lease_release_failed",
  "event_update_failed",
  "event_update_lease_claim_failed",
  "event_delete_in_progress",
  "event_delete_lease_lost",
  "event_delete_network_failed",
  "event_delete_provider_failed",
  "event_delete_rate_limited",
  "event_mapping_missing",
  "event_update_in_progress",
  "event_update_lease_lost",
  "mapping_delete_failed",
  "mapping_save_cleanup_failed",
  "mapping_save_failed",
  "mapping_error_save_failed",
  "mapping_update_failed",
  "preview_read_failed",
  "event_response_invalid",
  "sync_worker_failed",
]);

const WAITING_CONNECTION_ERROR_CODES = new Set([
  "google_not_connected",
  "not_connected",
  "invalid_connection",
]);

export type GoogleCalendarSyncJobClaimDecision =
  | "acquire"
  | "in_progress"
  | "not_ready";

function requireNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function appendUniqueReason(reasons: string[], reason: string): string[] {
  return [...new Set([...reasons, reason])];
}

export function buildGoogleCalendarSyncJobId(
  uid: string,
  projectId: string
): string {
  const normalizedUid = requireNonEmpty(uid, "uid");
  const normalizedProjectId = requireNonEmpty(projectId, "projectId");
  const canonicalKey = `${normalizedUid.length}:${normalizedUid}${normalizedProjectId.length}:${normalizedProjectId}`;
  return `project_user_${createHash("sha256").update(canonicalKey).digest("base64url")}`;
}

export function classifyGoogleCalendarSyncError(
  errorCode: string
): Exclude<GoogleCalendarSyncExecutionResult, { success: true }> {
  const normalized = requireNonEmpty(errorCode, "errorCode");
  return {
    success: false,
    retryable: RETRYABLE_SYNC_ERROR_CODES.has(normalized),
    errorCode: normalized,
  };
}

export function summarizeGoogleCalendarSyncResults(
  results: readonly GoogleCalendarSyncExecutionResult[]
): GoogleCalendarSyncExecutionResult {
  const failures = results.filter(
    (result): result is Exclude<GoogleCalendarSyncExecutionResult, { success: true }> =>
      !result.success
  );
  if (failures.length === 0) {
    return { success: true, retryable: false, errorCode: null };
  }

  const waiting = failures.find((result) =>
    WAITING_CONNECTION_ERROR_CODES.has(result.errorCode));
  if (waiting) return waiting;

  const retryable = failures.find((result) => result.retryable);
  return retryable ?? failures[0];
}

export function planGoogleCalendarSyncJobEnqueue(
  current: GoogleCalendarSyncJobState | null,
  input: {
    uid: string;
    projectId: string;
    reason: GoogleCalendarSyncJobReason;
  }
): GoogleCalendarSyncJobState {
  const uid = requireNonEmpty(input.uid, "uid");
  const projectId = requireNonEmpty(input.projectId, "projectId");
  const reason = requireNonEmpty(input.reason, "reason");

  if (!current) {
    return {
      uid,
      projectId,
      status: "pending",
      reasons: [reason],
      generation: 1,
      attemptCount: 0,
      nextAttemptAtMillis: null,
      lastAttemptAtMillis: null,
      lastSuccessAtMillis: null,
      lastErrorCode: null,
      retryNeeded: false,
      operationId: null,
      leaseStartedAtMillis: null,
    };
  }

  if (current.uid !== uid || current.projectId !== projectId) {
    throw new Error("Sync job identity does not match");
  }

  const generation = current.generation + 1;
  if (current.status === "running") {
    return {
      ...current,
      reasons: appendUniqueReason(current.reasons, reason),
      generation,
      retryNeeded: true,
    };
  }

  if (current.status === "waiting_connection"
    && reason !== GOOGLE_CALENDAR_SYNC_JOB_REASONS.GOOGLE_RECONNECTED) {
    return {
      ...current,
      reasons: appendUniqueReason(current.reasons, reason),
      generation,
      retryNeeded: true,
    };
  }

  const restartingTerminalJob = current.status === "succeeded"
    || current.status === "failed";
  return {
    ...current,
    status: "pending",
    reasons: restartingTerminalJob
      ? [reason]
      : appendUniqueReason(current.reasons, reason),
    generation,
    attemptCount: restartingTerminalJob
      || current.status === "waiting_connection"
      ? 0
      : current.attemptCount,
    nextAttemptAtMillis: null,
    lastErrorCode: null,
    retryNeeded: false,
    operationId: null,
    leaseStartedAtMillis: null,
  };
}

export function decideGoogleCalendarSyncJobClaim(
  state: GoogleCalendarSyncJobState,
  nowMillis: number,
  staleMilliseconds = GOOGLE_CALENDAR_SYNC_JOB_LEASE_STALE_MS
): GoogleCalendarSyncJobClaimDecision {
  if (state.status === "pending") return "acquire";
  if (state.status === "retry") {
    return state.nextAttemptAtMillis === null
      || state.nextAttemptAtMillis <= nowMillis
      ? "acquire"
      : "not_ready";
  }
  if (state.status === "running") {
    if (state.leaseStartedAtMillis === null) return "acquire";
    return nowMillis - state.leaseStartedAtMillis < staleMilliseconds
      ? "in_progress"
      : "acquire";
  }
  return "not_ready";
}

export function planGoogleCalendarSyncJobClaim(
  state: GoogleCalendarSyncJobState,
  operationId: string,
  nowMillis: number
): GoogleCalendarSyncJobState {
  return {
    ...state,
    status: "running",
    attemptCount: state.attemptCount + 1,
    nextAttemptAtMillis: null,
    lastAttemptAtMillis: nowMillis,
    retryNeeded: false,
    operationId: requireNonEmpty(operationId, "operationId"),
    leaseStartedAtMillis: nowMillis,
  };
}

export function ownsGoogleCalendarSyncJobLease(
  state: GoogleCalendarSyncJobState,
  operationId: string
): boolean {
  return state.status === "running" && state.operationId === operationId;
}

export function planGoogleCalendarSyncJobCompletion(
  state: GoogleCalendarSyncJobState,
  input: {
    operationId: string;
    claimedGeneration: number;
    nowMillis: number;
  }
): GoogleCalendarSyncJobState | null {
  if (!ownsGoogleCalendarSyncJobLease(state, input.operationId)) return null;

  const newerWorkArrived = state.generation !== input.claimedGeneration
    || state.retryNeeded;
  return {
    ...state,
    status: newerWorkArrived ? "pending" : "succeeded",
    nextAttemptAtMillis: null,
    lastSuccessAtMillis: input.nowMillis,
    lastErrorCode: null,
    retryNeeded: false,
    operationId: null,
    leaseStartedAtMillis: null,
  };
}

export function getGoogleCalendarSyncRetryDelayMillis(
  attemptCount: number
): number | null {
  if (!Number.isInteger(attemptCount) || attemptCount < 1) return null;
  return GOOGLE_CALENDAR_SYNC_JOB_RETRY_DELAYS_MS[attemptCount - 1] ?? null;
}

export function planGoogleCalendarSyncJobFailure(
  state: GoogleCalendarSyncJobState,
  input: {
    operationId: string;
    claimedGeneration: number;
    nowMillis: number;
    result: Exclude<GoogleCalendarSyncExecutionResult, { success: true }>;
  }
): GoogleCalendarSyncJobState | null {
  if (!ownsGoogleCalendarSyncJobLease(state, input.operationId)) return null;

  const errorCode = requireNonEmpty(input.result.errorCode, "errorCode");
  const common = {
    ...state,
    lastErrorCode: errorCode,
    retryNeeded: false,
    operationId: null,
    leaseStartedAtMillis: null,
  };

  if (state.generation !== input.claimedGeneration || state.retryNeeded) {
    return { ...common, status: "pending", nextAttemptAtMillis: null };
  }

  if (WAITING_CONNECTION_ERROR_CODES.has(errorCode)) {
    return {
      ...common,
      status: "waiting_connection",
      nextAttemptAtMillis: null,
    };
  }

  const retryDelay = input.result.retryable
    ? getGoogleCalendarSyncRetryDelayMillis(state.attemptCount)
    : null;
  if (retryDelay !== null
    && state.attemptCount <= GOOGLE_CALENDAR_SYNC_JOB_MAX_ATTEMPTS) {
    return {
      ...common,
      status: "retry",
      nextAttemptAtMillis: input.nowMillis + retryDelay,
    };
  }

  return { ...common, status: "failed", nextAttemptAtMillis: null };
}

export function planGoogleCalendarSyncJobLeaseRelease(
  state: GoogleCalendarSyncJobState,
  operationId: string
): GoogleCalendarSyncJobState | null {
  if (!ownsGoogleCalendarSyncJobLease(state, operationId)) return null;
  return {
    ...state,
    status: "pending",
    nextAttemptAtMillis: null,
    retryNeeded: false,
    operationId: null,
    leaseStartedAtMillis: null,
  };
}
