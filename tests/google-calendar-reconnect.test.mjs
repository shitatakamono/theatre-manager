import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planGoogleCalendarSyncJobEnqueue,
} from "../lib/google-calendar-sync-job.ts";
import {
  runGoogleCalendarReconnectCatchUp,
  selectGoogleCalendarRelatedProjectIds,
} from "../lib/google-calendar-reconnect.ts";

function candidate(overrides = {}) {
  return {
    projectId: "project-a",
    memberExists: true,
    linkedParticipantId: "person-a",
    personExists: true,
    ...overrides,
  };
}

describe("Google Calendar reconnect project discovery", () => {
  it("selects current explicitly linked member projects", () => {
    deepStrictEqual(selectGoogleCalendarRelatedProjectIds({
      linkedProjectCandidates: [candidate()],
      waitingJobProjectIds: [],
    }), ["project-a"]);
  });

  it("excludes members without links and links without membership or people", () => {
    deepStrictEqual(selectGoogleCalendarRelatedProjectIds({
      linkedProjectCandidates: [
        candidate({ projectId: "member-only", linkedParticipantId: null }),
        candidate({ projectId: "link-only", memberExists: false }),
        candidate({ projectId: "missing-person", personExists: false }),
      ],
      waitingJobProjectIds: [],
    }), []);
  });

  it("combines multiple current projects and waiting jobs without duplicates", () => {
    deepStrictEqual(selectGoogleCalendarRelatedProjectIds({
      linkedProjectCandidates: [
        candidate({ projectId: "project-b" }),
        candidate({ projectId: "project-a" }),
      ],
      waitingJobProjectIds: ["project-c", "project-a", "project-c"],
    }), ["project-a", "project-b", "project-c"]);
  });

  it("does not infer projects from names, emails, or unrelated properties", () => {
    deepStrictEqual(selectGoogleCalendarRelatedProjectIds({
      linkedProjectCandidates: [{
        ...candidate({ memberExists: false, linkedParticipantId: null }),
        name: "Same Name",
        email: "same@example.com",
      }],
      waitingJobProjectIds: [],
    }), []);
  });
});

describe("Google Calendar reconnect catch-up", () => {
  it("enqueues google_reconnected for every related project", async () => {
    const calls = [];
    const result = await runGoogleCalendarReconnectCatchUp({
      uid: "user-a",
      discoverProjectIds: async () => ["project-b", "project-a", "project-a"],
      enqueue: async (request) => calls.push(request),
    });
    deepStrictEqual(calls, [
      { uid: "user-a", projectId: "project-a", reason: "google_reconnected" },
      { uid: "user-a", projectId: "project-b", reason: "google_reconnected" },
    ]);
    deepStrictEqual(result, {
      projectCount: 2,
      enqueuedCount: 2,
      failedCount: 0,
      errorCodes: [],
    });
  });

  it("continues other projects and keeps connection success independent", async () => {
    const calls = [];
    const result = await runGoogleCalendarReconnectCatchUp({
      uid: "user-a",
      discoverProjectIds: async () => ["project-a", "project-b"],
      enqueue: async ({ projectId }) => {
        calls.push(projectId);
        if (projectId === "project-a") throw new Error("secret provider body");
      },
    });
    deepStrictEqual(calls, ["project-a", "project-b"]);
    deepStrictEqual(result, {
      projectCount: 2,
      enqueuedCount: 1,
      failedCount: 1,
      errorCodes: ["reconnect_enqueue_failed"],
    });
    strictEqual(JSON.stringify(result).includes("secret"), false);
  });

  it("returns a safe result when project discovery fails", async () => {
    const result = await runGoogleCalendarReconnectCatchUp({
      uid: "user-a",
      discoverProjectIds: async () => { throw new Error("private data"); },
      enqueue: async () => undefined,
    });
    deepStrictEqual(result, {
      projectCount: 0,
      enqueuedCount: 0,
      failedCount: 1,
      errorCodes: ["reconnect_project_discovery_failed"],
    });
  });

  it("returns a waiting_connection job to pending through the existing planner", () => {
    const current = {
      uid: "user-a",
      projectId: "project-a",
      status: "waiting_connection",
      reasons: ["rehearsal_updated"],
      generation: 2,
      attemptCount: 1,
      nextAttemptAtMillis: null,
      lastAttemptAtMillis: 100,
      lastSuccessAtMillis: null,
      lastErrorCode: "google_not_connected",
      retryNeeded: false,
      operationId: null,
      leaseStartedAtMillis: null,
    };
    const next = planGoogleCalendarSyncJobEnqueue(current, {
      uid: "user-a",
      projectId: "project-a",
      reason: "google_reconnected",
    });
    strictEqual(next.status, "pending");
    deepStrictEqual(next.reasons, ["rehearsal_updated", "google_reconnected"]);
    strictEqual(next.generation, 3);
  });
});
