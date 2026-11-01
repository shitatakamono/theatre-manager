import "server-only";

import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";

import {
  buildGoogleCalendarSyncJobId,
  decideGoogleCalendarSyncJobClaim,
  planGoogleCalendarSyncJobClaim,
  planGoogleCalendarSyncJobCompletion,
  planGoogleCalendarSyncJobEnqueue,
  planGoogleCalendarSyncJobFailure,
  planGoogleCalendarSyncJobLeaseRelease,
  type GoogleCalendarSyncExecutionResult,
  type GoogleCalendarSyncJobState,
  type GoogleCalendarSyncJobStatus,
} from "@/lib/google-calendar-sync-job";
import { adminDb } from "@/lib/server/firebase-admin";

const SYNC_JOBS_COLLECTION = "googleCalendarSyncJobs";

export type GoogleCalendarSyncJob = {
  uid: string;
  projectId: string;
  status: GoogleCalendarSyncJobStatus;
  reasons: string[];
  generation: number;
  attemptCount: number;
  nextAttemptAt: Timestamp | null;
  lastAttemptAt: Timestamp | null;
  lastSuccessAt: Timestamp | null;
  lastErrorCode: string | null;
  retryNeeded: boolean;
  operationId: string | null;
  leaseStartedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type GoogleCalendarSyncJobClaim =
  | {
      kind: "acquired";
      operationId: string;
      claimedGeneration: number;
      job: GoogleCalendarSyncJob;
    }
  | { kind: "in_progress" | "not_ready" | "missing" };

const JOB_STATUSES = new Set<GoogleCalendarSyncJobStatus>([
  "pending",
  "running",
  "retry",
  "succeeded",
  "failed",
  "waiting_connection",
]);

function jobRef(uid: string, projectId: string) {
  return adminDb.collection(SYNC_JOBS_COLLECTION).doc(
    buildGoogleCalendarSyncJobId(uid, projectId)
  );
}

function nullableTimestamp(value: unknown): value is Timestamp | null {
  return value === null || value instanceof Timestamp;
}

function storedJob(
  data: FirebaseFirestore.DocumentData | undefined
): GoogleCalendarSyncJob | null {
  if (!data
    || typeof data.uid !== "string"
    || typeof data.projectId !== "string"
    || !JOB_STATUSES.has(data.status)
    || !Array.isArray(data.reasons)
    || !data.reasons.every((reason: unknown) => typeof reason === "string")
    || !Number.isInteger(data.generation)
    || !Number.isInteger(data.attemptCount)
    || !nullableTimestamp(data.nextAttemptAt)
    || !nullableTimestamp(data.lastAttemptAt)
    || !nullableTimestamp(data.lastSuccessAt)
    || !(typeof data.lastErrorCode === "string" || data.lastErrorCode === null)
    || typeof data.retryNeeded !== "boolean"
    || !(typeof data.operationId === "string" || data.operationId === null)
    || !nullableTimestamp(data.leaseStartedAt)
    || !(data.createdAt instanceof Timestamp)
    || !(data.updatedAt instanceof Timestamp)) {
    return null;
  }
  return data as GoogleCalendarSyncJob;
}

function toState(job: GoogleCalendarSyncJob): GoogleCalendarSyncJobState {
  return {
    uid: job.uid,
    projectId: job.projectId,
    status: job.status,
    reasons: job.reasons,
    generation: job.generation,
    attemptCount: job.attemptCount,
    nextAttemptAtMillis: job.nextAttemptAt?.toMillis() ?? null,
    lastAttemptAtMillis: job.lastAttemptAt?.toMillis() ?? null,
    lastSuccessAtMillis: job.lastSuccessAt?.toMillis() ?? null,
    lastErrorCode: job.lastErrorCode,
    retryNeeded: job.retryNeeded,
    operationId: job.operationId,
    leaseStartedAtMillis: job.leaseStartedAt?.toMillis() ?? null,
  };
}

function timestampOrNull(value: number | null): Timestamp | null {
  return value === null ? null : Timestamp.fromMillis(value);
}

function toStoredJob(
  state: GoogleCalendarSyncJobState,
  createdAt: Timestamp,
  updatedAt: Timestamp
): GoogleCalendarSyncJob {
  return {
    uid: state.uid,
    projectId: state.projectId,
    status: state.status,
    reasons: state.reasons,
    generation: state.generation,
    attemptCount: state.attemptCount,
    nextAttemptAt: timestampOrNull(state.nextAttemptAtMillis),
    lastAttemptAt: timestampOrNull(state.lastAttemptAtMillis),
    lastSuccessAt: timestampOrNull(state.lastSuccessAtMillis),
    lastErrorCode: state.lastErrorCode,
    retryNeeded: state.retryNeeded,
    operationId: state.operationId,
    leaseStartedAt: timestampOrNull(state.leaseStartedAtMillis),
    createdAt,
    updatedAt,
  };
}

export async function getGoogleCalendarSyncJob(
  uid: string,
  projectId: string
): Promise<GoogleCalendarSyncJob | null> {
  const snapshot = await jobRef(uid, projectId).get();
  return storedJob(snapshot.data());
}

export async function enqueueGoogleCalendarProjectSync(input: {
  uid: string;
  projectId: string;
  reason: string;
}): Promise<GoogleCalendarSyncJob> {
  const ref = jobRef(input.uid, input.projectId);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = storedJob(snapshot.data());
    if (snapshot.exists && !current) {
      throw new Error("Invalid Google Calendar sync job");
    }

    const now = Timestamp.now();
    const nextState = planGoogleCalendarSyncJobEnqueue(
      current ? toState(current) : null,
      input
    );
    const nextJob = toStoredJob(
      nextState,
      current?.createdAt ?? now,
      now
    );
    transaction.set(ref, nextJob);
    return nextJob;
  });
}

export async function claimGoogleCalendarSyncJob(
  uid: string,
  projectId: string
): Promise<GoogleCalendarSyncJobClaim> {
  const ref = jobRef(uid, projectId);
  const operationId = randomBytes(18).toString("base64url");

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = storedJob(snapshot.data());
    if (!current) return { kind: "missing" };

    const state = toState(current);
    const now = Timestamp.now();
    const decision = decideGoogleCalendarSyncJobClaim(state, now.toMillis());
    if (decision === "in_progress") return { kind: "in_progress" };
    if (decision === "not_ready") return { kind: "not_ready" };

    const claimedGeneration = state.generation;
    const claimed = planGoogleCalendarSyncJobClaim(
      state,
      operationId,
      now.toMillis()
    );
    const job = toStoredJob(claimed, current.createdAt, now);
    transaction.set(ref, job);
    return { kind: "acquired", operationId, claimedGeneration, job };
  });
}

export async function completeGoogleCalendarSyncJob(input: {
  uid: string;
  projectId: string;
  operationId: string;
  claimedGeneration: number;
}): Promise<"succeeded" | "rescheduled" | "rejected"> {
  const ref = jobRef(input.uid, input.projectId);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = storedJob(snapshot.data());
    if (!current) return "rejected";

    const now = Timestamp.now();
    const completed = planGoogleCalendarSyncJobCompletion(toState(current), {
      operationId: input.operationId,
      claimedGeneration: input.claimedGeneration,
      nowMillis: now.toMillis(),
    });
    if (!completed) return "rejected";

    transaction.set(ref, toStoredJob(completed, current.createdAt, now));
    return completed.status === "succeeded" ? "succeeded" : "rescheduled";
  });
}

export async function failGoogleCalendarSyncJob(input: {
  uid: string;
  projectId: string;
  operationId: string;
  claimedGeneration: number;
  result: Exclude<GoogleCalendarSyncExecutionResult, { success: true }>;
}): Promise<GoogleCalendarSyncJobStatus | "rejected"> {
  const ref = jobRef(input.uid, input.projectId);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = storedJob(snapshot.data());
    if (!current) return "rejected";

    const now = Timestamp.now();
    const failed = planGoogleCalendarSyncJobFailure(toState(current), {
      operationId: input.operationId,
      claimedGeneration: input.claimedGeneration,
      nowMillis: now.toMillis(),
      result: input.result,
    });
    if (!failed) return "rejected";

    transaction.set(ref, toStoredJob(failed, current.createdAt, now));
    return failed.status;
  });
}

export async function releaseGoogleCalendarSyncJobLease(input: {
  uid: string;
  projectId: string;
  operationId: string;
}): Promise<boolean> {
  const ref = jobRef(input.uid, input.projectId);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = storedJob(snapshot.data());
    if (!current) return false;

    const released = planGoogleCalendarSyncJobLeaseRelease(
      toState(current),
      input.operationId
    );
    if (!released) return false;

    const now = Timestamp.now();
    transaction.set(ref, toStoredJob(released, current.createdAt, now));
    return true;
  });
}
