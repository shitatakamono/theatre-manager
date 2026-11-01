import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGoogleCalendarSyncJobId,
  classifyGoogleCalendarSyncError,
  decideGoogleCalendarSyncJobClaim,
  getGoogleCalendarSyncRetryDelayMillis,
  GOOGLE_CALENDAR_SYNC_JOB_LEASE_STALE_MS,
  GOOGLE_CALENDAR_SYNC_JOB_MAX_ATTEMPTS,
  GOOGLE_CALENDAR_SYNC_JOB_REASONS,
  planGoogleCalendarSyncJobClaim,
  planGoogleCalendarSyncJobCompletion,
  planGoogleCalendarSyncJobEnqueue,
  planGoogleCalendarSyncJobFailure,
  planGoogleCalendarSyncJobLeaseRelease,
  summarizeGoogleCalendarSyncResults,
} from "../lib/google-calendar-sync-job.ts";

function initialJob(reason = "rehearsal_created") {
  return planGoogleCalendarSyncJobEnqueue(null, {
    uid: "user-a",
    projectId: "project-a",
    reason,
  });
}

function runningJob({ generation = 1, attemptCount = 1 } = {}) {
  return {
    ...planGoogleCalendarSyncJobClaim(initialJob(), "operation-a", 1_000),
    generation,
    attemptCount,
  };
}

describe("Google Calendar sync job helpers", () => {
  it("builds a deterministic, safe job ID per uid and project", () => {
    const first = buildGoogleCalendarSyncJobId("user-a", "project-a");
    strictEqual(first, buildGoogleCalendarSyncJobId("user-a", "project-a"));
    strictEqual(first.includes("/"), false);
    notStrictEqual(first, buildGoogleCalendarSyncJobId("user-b", "project-a"));
    notStrictEqual(first, buildGoogleCalendarSyncJobId("user-a", "project-b"));
  });

  it("creates the first enqueue as pending", () => {
    const job = initialJob();
    strictEqual(job.status, "pending");
    deepStrictEqual(job.reasons, ["rehearsal_created"]);
    strictEqual(job.generation, 1);
    strictEqual(job.attemptCount, 0);
  });

  it("coalesces pending reasons without duplicates and increments generation", () => {
    const withUpdate = planGoogleCalendarSyncJobEnqueue(initialJob(), {
      uid: "user-a",
      projectId: "project-a",
      reason: "rehearsal_updated",
    });
    const duplicate = planGoogleCalendarSyncJobEnqueue(withUpdate, {
      uid: "user-a",
      projectId: "project-a",
      reason: "rehearsal_updated",
    });
    deepStrictEqual(duplicate.reasons, ["rehearsal_created", "rehearsal_updated"]);
    strictEqual(duplicate.generation, 3);
  });

  it("marks a running job for another pass when enqueue occurs", () => {
    const enqueued = planGoogleCalendarSyncJobEnqueue(runningJob(), {
      uid: "user-a",
      projectId: "project-a",
      reason: "person_changed",
    });
    strictEqual(enqueued.status, "running");
    strictEqual(enqueued.retryNeeded, true);
    strictEqual(enqueued.generation, 2);
  });

  for (const status of ["succeeded", "failed"]) {
    it(`returns a ${status} job to pending for new work`, () => {
      const restarted = planGoogleCalendarSyncJobEnqueue({
        ...initialJob("old_reason"),
        status,
        attemptCount: 5,
        lastErrorCode: status === "failed" ? "permission_denied" : null,
      }, {
        uid: "user-a",
        projectId: "project-a",
        reason: "rehearsal_updated",
      });
      strictEqual(restarted.status, "pending");
      deepStrictEqual(restarted.reasons, ["rehearsal_updated"]);
      strictEqual(restarted.attemptCount, 0);
    });
  }

  it("keeps waiting jobs blocked while accumulating reasons", () => {
    const waiting = {
      ...initialJob(),
      status: "waiting_connection",
      lastErrorCode: "google_not_connected",
    };
    const changed = planGoogleCalendarSyncJobEnqueue(waiting, {
      uid: "user-a",
      projectId: "project-a",
      reason: "participation_changed",
    });
    strictEqual(changed.status, "waiting_connection");
    strictEqual(changed.retryNeeded, true);
    deepStrictEqual(changed.reasons, ["rehearsal_created", "participation_changed"]);
  });

  it("resumes waiting jobs after Google reconnects", () => {
    const resumed = planGoogleCalendarSyncJobEnqueue({
      ...initialJob(),
      status: "waiting_connection",
      lastErrorCode: "google_not_connected",
    }, {
      uid: "user-a",
      projectId: "project-a",
      reason: GOOGLE_CALENDAR_SYNC_JOB_REASONS.GOOGLE_RECONNECTED,
    });
    strictEqual(resumed.status, "pending");
    strictEqual(resumed.attemptCount, 0);
    strictEqual(resumed.lastErrorCode, null);
  });

  it("rejects an active lease and permits stale lease takeover", () => {
    const running = runningJob();
    strictEqual(
      decideGoogleCalendarSyncJobClaim(
        running,
        1_000 + GOOGLE_CALENDAR_SYNC_JOB_LEASE_STALE_MS - 1
      ),
      "in_progress"
    );
    strictEqual(
      decideGoogleCalendarSyncJobClaim(
        running,
        1_000 + GOOGLE_CALENDAR_SYNC_JOB_LEASE_STALE_MS
      ),
      "acquire"
    );
  });

  it("only permits the owning operation to complete", () => {
    const completed = planGoogleCalendarSyncJobCompletion(runningJob(), {
      operationId: "operation-b",
      claimedGeneration: 1,
      nowMillis: 2_000,
    });
    strictEqual(completed, null);
  });

  it("succeeds when no newer generation arrived", () => {
    const completed = planGoogleCalendarSyncJobCompletion(runningJob(), {
      operationId: "operation-a",
      claimedGeneration: 1,
      nowMillis: 2_000,
    });
    strictEqual(completed?.status, "succeeded");
    strictEqual(completed?.lastSuccessAtMillis, 2_000);
    strictEqual(completed?.operationId, null);
  });

  it("returns to pending when generation changed during execution", () => {
    const changed = planGoogleCalendarSyncJobEnqueue(runningJob(), {
      uid: "user-a",
      projectId: "project-a",
      reason: "cast_staff_changed",
    });
    const completed = planGoogleCalendarSyncJobCompletion(changed, {
      operationId: "operation-a",
      claimedGeneration: 1,
      nowMillis: 2_000,
    });
    strictEqual(completed?.status, "pending");
    strictEqual(completed?.lastSuccessAtMillis, 2_000);
  });

  it("uses the configured exponential retry schedule", () => {
    deepStrictEqual(
      Array.from({ length: GOOGLE_CALENDAR_SYNC_JOB_MAX_ATTEMPTS }, (_, index) =>
        getGoogleCalendarSyncRetryDelayMillis(index + 1)),
      [60_000, 300_000, 900_000, 3_600_000, 21_600_000]
    );
  });

  it("moves retryable failures to retry with a next attempt", () => {
    const failed = planGoogleCalendarSyncJobFailure(runningJob(), {
      operationId: "operation-a",
      claimedGeneration: 1,
      nowMillis: 10_000,
      result: { success: false, retryable: true, errorCode: "network_error" },
    });
    strictEqual(failed?.status, "retry");
    strictEqual(failed?.nextAttemptAtMillis, 70_000);
  });

  it("uses the six-hour backoff on the fifth failed attempt", () => {
    const failed = planGoogleCalendarSyncJobFailure(runningJob({
      attemptCount: GOOGLE_CALENDAR_SYNC_JOB_MAX_ATTEMPTS,
    }), {
      operationId: "operation-a",
      claimedGeneration: 1,
      nowMillis: 10_000,
      result: { success: false, retryable: true, errorCode: "google_server_error" },
    });
    strictEqual(failed?.status, "retry");
    strictEqual(failed?.nextAttemptAtMillis, 21_610_000);
  });

  it("moves attempts beyond the retry limit to failed", () => {
    const failed = planGoogleCalendarSyncJobFailure(runningJob({
      attemptCount: GOOGLE_CALENDAR_SYNC_JOB_MAX_ATTEMPTS + 1,
    }), {
      operationId: "operation-a",
      claimedGeneration: 1,
      nowMillis: 10_000,
      result: { success: false, retryable: true, errorCode: "google_server_error" },
    });
    strictEqual(failed?.status, "failed");
    strictEqual(failed?.nextAttemptAtMillis, null);
  });

  it("moves disconnected users to waiting_connection", () => {
    const failed = planGoogleCalendarSyncJobFailure(runningJob(), {
      operationId: "operation-a",
      claimedGeneration: 1,
      nowMillis: 10_000,
      result: {
        success: false,
        retryable: false,
        errorCode: "google_not_connected",
      },
    });
    strictEqual(failed?.status, "waiting_connection");
    strictEqual(failed?.nextAttemptAtMillis, null);
  });

  it("moves an invalid connection to waiting_connection", () => {
    const failed = planGoogleCalendarSyncJobFailure(runningJob(), {
      operationId: "operation-a",
      claimedGeneration: 1,
      nowMillis: 10_000,
      result: {
        success: false,
        retryable: false,
        errorCode: "invalid_connection",
      },
    });
    strictEqual(failed?.status, "waiting_connection");
  });

  it("moves a non-retryable failure to failed", () => {
    const failed = planGoogleCalendarSyncJobFailure(runningJob(), {
      operationId: "operation-a",
      claimedGeneration: 1,
      nowMillis: 10_000,
      result: classifyGoogleCalendarSyncError("permission_denied"),
    });
    strictEqual(failed?.status, "failed");
  });

  it("releases only the currently owned lease back to pending", () => {
    strictEqual(
      planGoogleCalendarSyncJobLeaseRelease(runningJob(), "operation-b"),
      null
    );
    const released = planGoogleCalendarSyncJobLeaseRelease(
      runningJob(),
      "operation-a"
    );
    strictEqual(released?.status, "pending");
    strictEqual(released?.operationId, null);
  });

  it("classifies existing transient codes and summarizes multiple results", () => {
    const transient = classifyGoogleCalendarSyncError("event_update_failed");
    const permanent = classifyGoogleCalendarSyncError("permission_denied");
    strictEqual(transient.retryable, true);
    strictEqual(permanent.retryable, false);
    deepStrictEqual(summarizeGoogleCalendarSyncResults([
      { success: true, retryable: false, errorCode: null },
      permanent,
      transient,
    ]), transient);
  });

  it("prioritizes a disconnected result so the job waits for reconnection", () => {
    const disconnected = classifyGoogleCalendarSyncError("not_connected");
    deepStrictEqual(summarizeGoogleCalendarSyncResults([
      classifyGoogleCalendarSyncError("network_error"),
      disconnected,
    ]), disconnected);
  });

  it("preserves both concurrent enqueue intents through transaction-order planning", () => {
    const first = planGoogleCalendarSyncJobEnqueue(initialJob(), {
      uid: "user-a",
      projectId: "project-a",
      reason: "person_changed",
    });
    const second = planGoogleCalendarSyncJobEnqueue(first, {
      uid: "user-a",
      projectId: "project-a",
      reason: "link_changed",
    });
    deepStrictEqual(second.reasons, [
      "rehearsal_created",
      "person_changed",
      "link_changed",
    ]);
    strictEqual(second.generation, 3);
  });

  it("does not include secret or Google resource fields in the job schema", () => {
    const keys = Object.keys(initialJob());
    for (const forbidden of [
      "token",
      "refreshToken",
      "accessToken",
      "calendarId",
      "googleEventId",
      "clientSecret",
    ]) {
      strictEqual(keys.includes(forbidden), false);
    }
  });
});
