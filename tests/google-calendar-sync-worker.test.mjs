import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyGoogleCalendarSyncError,
} from "../lib/google-calendar-sync-job.ts";
import {
  executeGoogleCalendarSyncWorker,
  planGoogleCalendarSyncWorkerOperations,
} from "../lib/google-calendar-sync-worker.ts";

function workerHarness(overrides = {}) {
  const calls = [];
  const operationResults = overrides.operationResults ?? {};
  const dependencies = {
    claim: async () => overrides.claim ?? {
      kind: "acquired",
      operationId: "job-operation-a",
      claimedGeneration: 3,
      reasons: overrides.reasons ?? ["rehearsal_created"],
    },
    checkConnection: async () => overrides.connection ?? {
      success: true,
      retryable: false,
      errorCode: null,
    },
    checkIdentity: async () => overrides.identity ?? {
      success: true,
      retryable: false,
      errorCode: null,
    },
    runOperation: async (operation) => {
      calls.push(operation);
      const value = operationResults[operation];
      if (value instanceof Error) throw value;
      return value ?? { success: true, errorCodes: [] };
    },
    complete: async (input) => {
      calls.push({ complete: input });
      return overrides.completion ?? "succeeded";
    },
    fail: async (input) => {
      calls.push({ fail: input });
      if (overrides.failStatus) return overrides.failStatus;
      if (["google_not_connected", "invalid_connection"].includes(
        input.result.errorCode
      )) return "waiting_connection";
      return input.result.retryable ? "retry" : "failed";
    },
    classifyError: (error) => classifyGoogleCalendarSyncError(
      typeof error?.code === "string" ? error.code : "sync_worker_failed"
    ),
  };
  return { calls, dependencies };
}

describe("Google Calendar sync worker planning", () => {
  for (const [reason, expected] of [
    ["rehearsal_created", ["reconcile"]],
    ["rehearsal_updated", ["reconcile", "update"]],
    ["rehearsal_deleted", ["delete"]],
    ["participation_changed", ["reconcile"]],
    ["cast_staff_changed", ["reconcile"]],
    ["google_reconnected", ["reconcile", "update"]],
  ]) {
    it(`plans ${reason} safely`, () => {
      deepStrictEqual(planGoogleCalendarSyncWorkerOperations([reason]), expected);
    });
  }

  it("deduplicates operations and preserves delete/reconcile/update order", () => {
    deepStrictEqual(planGoogleCalendarSyncWorkerOperations([
      "rehearsal_updated",
      "rehearsal_deleted",
      "rehearsal_updated",
      "participation_changed",
    ]), ["delete", "reconcile", "update"]);
  });

  it("uses a full safe catch-up for unknown or empty reasons", () => {
    deepStrictEqual(planGoogleCalendarSyncWorkerOperations(["future_reason"]), [
      "delete",
      "reconcile",
      "update",
    ]);
    deepStrictEqual(planGoogleCalendarSyncWorkerOperations([]), [
      "delete",
      "reconcile",
      "update",
    ]);
  });
});

describe("Google Calendar single-user sync worker", () => {
  for (const claimKind of ["missing", "not_ready", "in_progress"]) {
    it(`does nothing when claim returns ${claimKind}`, async () => {
      const { calls, dependencies } = workerHarness({
        claim: { kind: claimKind },
      });
      const result = await executeGoogleCalendarSyncWorker(dependencies);
      strictEqual(result.kind, "not_claimed");
      deepStrictEqual(calls, []);
    });
  }

  it("completes a successfully claimed job", async () => {
    const { calls, dependencies } = workerHarness();
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    deepStrictEqual(result, {
      kind: "completed",
      completion: "succeeded",
      operations: ["reconcile"],
    });
    deepStrictEqual(calls, [
      "reconcile",
      {
        complete: {
          operationId: "job-operation-a",
          claimedGeneration: 3,
        },
      },
    ]);
  });

  it("reports rescheduled when the existing completion logic sees a new generation", async () => {
    const { dependencies } = workerHarness({ completion: "rescheduled" });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    strictEqual(result.kind, "completed");
    strictEqual(result.completion, "rescheduled");
  });

  for (const errorCode of ["google_not_connected", "invalid_connection"]) {
    it(`does not call Google sync for connection error ${errorCode}`, async () => {
      const { calls, dependencies } = workerHarness({
        connection: classifyGoogleCalendarSyncError(errorCode),
      });
      const result = await executeGoogleCalendarSyncWorker(dependencies);
      strictEqual(result.kind, "failed");
      strictEqual(result.jobStatus, "waiting_connection");
      deepStrictEqual(result.operations, []);
      strictEqual(calls.some((call) => typeof call === "string"), false);
    });
  }

  for (const errorCode of [
    "user_not_linked",
    "not_project_member",
    "person_not_found",
  ]) {
    it(`does not reconcile for identity error ${errorCode}`, async () => {
      const { calls, dependencies } = workerHarness({
        reasons: ["participation_changed"],
        identity: classifyGoogleCalendarSyncError(errorCode),
      });
      const result = await executeGoogleCalendarSyncWorker(dependencies);
      strictEqual(result.kind, "failed");
      strictEqual(result.jobStatus, "failed");
      deepStrictEqual(result.operations, []);
      strictEqual(calls.some((call) => typeof call === "string"), false);
    });
  }

  for (const errorCode of ["google_not_connected", "invalid_connection"]) {
    it(`does not run a mapping-owner delete for ${errorCode}`, async () => {
      const { calls, dependencies } = workerHarness({
        reasons: ["rehearsal_deleted"],
        connection: classifyGoogleCalendarSyncError(errorCode),
      });
      const result = await executeGoogleCalendarSyncWorker(dependencies);
      strictEqual(result.kind, "failed");
      strictEqual(result.jobStatus, "waiting_connection");
      deepStrictEqual(result.operations, []);
      strictEqual(calls.some((call) => typeof call === "string"), false);
    });
  }

  for (const errorCode of [
    "user_not_linked",
    "not_project_member",
    "person_not_found",
  ]) {
    it(`allows a mapping-owner delete despite ${errorCode}`, async () => {
      const { dependencies } = workerHarness({
        reasons: ["rehearsal_deleted"],
        identity: classifyGoogleCalendarSyncError(errorCode),
      });
      const result = await executeGoogleCalendarSyncWorker(dependencies);
      deepStrictEqual(result, {
        kind: "completed",
        completion: "succeeded",
        operations: ["delete"],
      });
    });
  }

  it("runs only delete for mixed reasons when the current link is missing", async () => {
    const { calls, dependencies } = workerHarness({
      reasons: ["rehearsal_deleted", "participation_changed"],
      identity: classifyGoogleCalendarSyncError("user_not_linked"),
    });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    strictEqual(result.kind, "failed");
    strictEqual(result.jobStatus, "failed");
    deepStrictEqual(result.operations, ["delete"]);
    deepStrictEqual(calls.filter((call) => typeof call === "string"), ["delete"]);
  });

  it("moves a retryable Google failure to retry", async () => {
    const { dependencies } = workerHarness({
      reasons: ["rehearsal_updated"],
      operationResults: {
        update: { success: false, errorCodes: ["event_update_failed"] },
      },
    });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    strictEqual(result.kind, "failed");
    strictEqual(result.jobStatus, "retry");
    strictEqual(result.errorCode, "event_update_failed");
  });

  it("moves a non-retryable sync failure to failed", async () => {
    const { dependencies } = workerHarness({
      reasons: ["rehearsal_updated"],
      operationResults: {
        update: { success: false, errorCodes: ["missing_end_at"] },
      },
    });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    strictEqual(result.kind, "failed");
    strictEqual(result.jobStatus, "failed");
  });

  it("runs reconcile and update and aggregates an update failure", async () => {
    const { calls, dependencies } = workerHarness({
      reasons: ["rehearsal_updated"],
      operationResults: {
        reconcile: { success: true, errorCodes: [] },
        update: { success: false, errorCodes: ["event_update_failed"] },
      },
    });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    deepStrictEqual(result.operations, ["reconcile", "update"]);
    deepStrictEqual(calls.slice(0, 2), ["reconcile", "update"]);
    strictEqual(result.kind, "failed");
  });

  it("completes after both reconcile and update succeed", async () => {
    const { dependencies } = workerHarness({
      reasons: ["rehearsal_updated"],
    });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    deepStrictEqual(result, {
      kind: "completed",
      completion: "succeeded",
      operations: ["reconcile", "update"],
    });
  });

  it("runs only delete for a deleted rehearsal reason", async () => {
    const { dependencies } = workerHarness({ reasons: ["rehearsal_deleted"] });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    deepStrictEqual(result.operations, ["delete"]);
    strictEqual(result.kind, "completed");
  });

  it("runs each required operation once for multiple reasons", async () => {
    const { dependencies } = workerHarness({
      reasons: [
        "rehearsal_deleted",
        "rehearsal_updated",
        "participation_changed",
      ],
    });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    deepStrictEqual(result.operations, ["delete", "reconcile", "update"]);
  });

  it("surfaces an operation ownership mismatch without inventing completion", async () => {
    const { dependencies } = workerHarness({ completion: "rejected" });
    const result = await executeGoogleCalendarSyncWorker(dependencies);
    deepStrictEqual(result, {
      kind: "lease_lost",
      operations: ["reconcile"],
    });
  });

  it("delegates reruns to the same mapping-lease protected helper boundary", async () => {
    const first = workerHarness({ reasons: ["rehearsal_created"] });
    const second = workerHarness({ reasons: ["rehearsal_created"] });
    await executeGoogleCalendarSyncWorker(first.dependencies);
    await executeGoogleCalendarSyncWorker(second.dependencies);
    deepStrictEqual(first.calls.filter((call) => typeof call === "string"), [
      "reconcile",
    ]);
    deepStrictEqual(second.calls.filter((call) => typeof call === "string"), [
      "reconcile",
    ]);
  });

  it("does not expose secrets or Google resource IDs in its result", async () => {
    const { dependencies } = workerHarness();
    const serialized = JSON.stringify(
      await executeGoogleCalendarSyncWorker(dependencies)
    );
    for (const forbidden of [
      "accessToken",
      "refreshToken",
      "calendarId",
      "googleEventId",
      "clientSecret",
    ]) {
      strictEqual(serialized.includes(forbidden), false);
    }
  });
});
