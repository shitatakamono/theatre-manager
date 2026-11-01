import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSafeGoogleCalendarSyncStatus,
  handleGoogleCalendarResyncRequest,
  handleGoogleCalendarSyncStatusRequest,
} from "../lib/google-calendar-sync-control.ts";
import {
  planGoogleCalendarSyncJobEnqueue,
} from "../lib/google-calendar-sync-job.ts";

function status(overrides = {}) {
  return buildSafeGoogleCalendarSyncStatus({
    connected: true,
    job: null,
    ...overrides,
  });
}

function dependencies(overrides = {}) {
  return {
    verifyIdToken: async () => ({ uid: "user-a" }),
    isProjectMember: async () => true,
    getStatus: async () => status(),
    enqueueManualRetry: async () => undefined,
    ...overrides,
  };
}

function authorizedRequest(url, init = {}) {
  return new Request(url, {
    ...init,
    headers: {
      authorization: "Bearer test-token",
      "content-type": "application/json",
      ...init.headers,
    },
  });
}

describe("Google Calendar safe sync status", () => {
  it("returns a safe initial state when no job exists", () => {
    deepStrictEqual(status(), {
      connected: true,
      syncStatus: "not_started",
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastErrorCode: null,
      retryNeeded: false,
      nextAttemptAt: null,
    });
  });

  for (const syncStatus of [
    "pending",
    "running",
    "retry",
    "waiting_connection",
    "succeeded",
    "failed",
  ]) {
    it(`returns safe ${syncStatus} fields without lease or resource IDs`, () => {
      const result = status({
        connected: false,
        job: {
          status: syncStatus,
          lastSuccessAt: "2026-11-01T00:00:00.000Z",
          lastAttemptAt: "2026-11-01T01:00:00.000Z",
          lastErrorCode: "safe_error_code",
          retryNeeded: true,
          nextAttemptAt: "2026-11-01T02:00:00.000Z",
          operationId: "must-not-leak",
          calendarId: "must-not-leak",
          googleEventId: "must-not-leak",
        },
      });
      strictEqual(result.syncStatus, syncStatus);
      const serialized = JSON.stringify(result);
      for (const forbidden of ["operationId", "calendarId", "googleEventId", "must-not-leak"]) {
        strictEqual(serialized.includes(forbidden), false);
      }
    });
  }
});

describe("Google Calendar sync control API handlers", () => {
  it("requires a Firebase bearer token", async () => {
    const response = await handleGoogleCalendarSyncStatusRequest(
      new Request("http://localhost/api/google-calendar/sync-status?projectId=project-a"),
      dependencies()
    );
    strictEqual(response.status, 401);
  });

  it("rejects an invalid Firebase bearer token", async () => {
    const response = await handleGoogleCalendarResyncRequest(
      authorizedRequest("http://localhost/api/google-calendar/resync", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-a" }),
      }),
      dependencies({ verifyIdToken: async () => { throw new Error("invalid"); } })
    );
    strictEqual(response.status, 401);
  });

  it("returns only the authenticated member's project status", async () => {
    const response = await handleGoogleCalendarSyncStatusRequest(
      authorizedRequest("http://localhost/api/google-calendar/sync-status?projectId=project-a"),
      dependencies()
    );
    strictEqual(response.status, 200);
    strictEqual((await response.json()).syncStatus, "not_started");
  });

  it("does not expose another project's status to a nonmember", async () => {
    let reads = 0;
    const response = await handleGoogleCalendarSyncStatusRequest(
      authorizedRequest("http://localhost/api/google-calendar/sync-status?projectId=project-b"),
      dependencies({
        isProjectMember: async () => false,
        getStatus: async () => { reads += 1; return status(); },
      })
    );
    strictEqual(response.status, 403);
    strictEqual(reads, 0);
  });

  it("enqueues manual_retry for the authenticated member", async () => {
    const calls = [];
    const response = await handleGoogleCalendarResyncRequest(
      authorizedRequest("http://localhost/api/google-calendar/resync", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-a" }),
      }),
      dependencies({ enqueueManualRetry: async (request) => calls.push(request) })
    );
    strictEqual(response.status, 202);
    deepStrictEqual(calls, [{
      uid: "user-a",
      projectId: "project-a",
      reason: "manual_retry",
    }]);
  });

  it("rejects manual retry for a nonmember", async () => {
    let enqueues = 0;
    const response = await handleGoogleCalendarResyncRequest(
      authorizedRequest("http://localhost/api/google-calendar/resync", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-a" }),
      }),
      dependencies({
        isProjectMember: async () => false,
        enqueueManualRetry: async () => { enqueues += 1; },
      })
    );
    strictEqual(response.status, 403);
    strictEqual(enqueues, 0);
  });

  it("allows enqueue while disconnected so the job safely waits for reconnection", async () => {
    let enqueues = 0;
    const response = await handleGoogleCalendarResyncRequest(
      authorizedRequest("http://localhost/api/google-calendar/resync", {
        method: "POST",
        body: JSON.stringify({ projectId: "project-a" }),
      }),
      dependencies({
        getStatus: async () => status({ connected: false }),
        enqueueManualRetry: async () => { enqueues += 1; },
      })
    );
    strictEqual(response.status, 202);
    strictEqual(enqueues, 1);
  });

  it("coalesces duplicate manual retries through the existing planner", () => {
    const input = { uid: "user-a", projectId: "project-a", reason: "manual_retry" };
    const first = planGoogleCalendarSyncJobEnqueue(null, input);
    const second = planGoogleCalendarSyncJobEnqueue(first, input);
    deepStrictEqual(second.reasons, ["manual_retry"]);
    strictEqual(second.generation, 2);
  });
});
