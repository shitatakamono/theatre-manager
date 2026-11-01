import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGoogleCalendarDeleteSyncPlan,
  classifyGoogleCalendarDeleteResponse,
  deleteGoogleCalendarMappedEvent,
  summarizeGoogleCalendarDeleteSync,
} from "../lib/google-calendar-delete-sync.ts";
import {
  decideGoogleCalendarEventDeleteLease,
  GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS,
  ownsGoogleCalendarEventDeleteLease,
} from "../lib/google-calendar-event-mapping.ts";

function mapping(index, projectId = "project-a") {
  return {
    projectId,
    rehearsalId: `rehearsal-${index}`,
  };
}

describe("Google Calendar delete sync", () => {
  it("selects one deleted rehearsal from twelve mappings and eleven rehearsals", () => {
    const mappings = Array.from({ length: 12 }, (_, index) => mapping(index));
    const existing = new Set(mappings.slice(0, 11).map(({ rehearsalId }) => rehearsalId));
    const plan = buildGoogleCalendarDeleteSyncPlan("project-a", mappings, existing);
    strictEqual(plan.mappedCount, 12);
    strictEqual(plan.existingRehearsalCount, 11);
    deepStrictEqual(plan.deleteTargets.map(({ rehearsalId }) => rehearsalId), ["rehearsal-11"]);
  });

  it("selects none when all rehearsals exist and multiple when multiple were deleted", () => {
    const mappings = [mapping(0), mapping(1), mapping(2)];
    strictEqual(buildGoogleCalendarDeleteSyncPlan(
      "project-a",
      mappings,
      new Set(mappings.map(({ rehearsalId }) => rehearsalId))
    ).deleteTargets.length, 0);
    deepStrictEqual(buildGoogleCalendarDeleteSyncPlan(
      "project-a",
      mappings,
      new Set(["rehearsal-0"])
    ).deleteTargets.map(({ rehearsalId }) => rehearsalId), ["rehearsal-1", "rehearsal-2"]);
  });

  it("never includes another project's mapping", () => {
    const plan = buildGoogleCalendarDeleteSyncPlan(
      "project-a",
      [mapping(0), mapping(1, "project-b")],
      new Set()
    );
    strictEqual(plan.mappedCount, 1);
    deepStrictEqual(plan.deleteTargets, [mapping(0)]);
  });

  it("treats 2xx and 404 as converged and keeps retryable failures distinct", () => {
    strictEqual(classifyGoogleCalendarDeleteResponse(204).status, "deleted");
    strictEqual(classifyGoogleCalendarDeleteResponse(404).status, "already_missing");
    deepStrictEqual(classifyGoogleCalendarDeleteResponse(401), {
      status: "failed",
      code: "event_delete_unauthorized",
      providerStatus: 401,
    });
    strictEqual(classifyGoogleCalendarDeleteResponse(403).status, "failed");
    strictEqual(classifyGoogleCalendarDeleteResponse(429).status, "failed");
    strictEqual(classifyGoogleCalendarDeleteResponse(500).status, "failed");
    deepStrictEqual(classifyGoogleCalendarDeleteResponse(null), {
      status: "failed",
      code: "event_delete_network_failed",
      providerStatus: null,
    });
  });

  it("deletes the mapping only after Google DELETE succeeds", async () => {
    const order = [];
    const result = await deleteGoogleCalendarMappedEvent({
      deleteGoogleEvent: async () => {
        order.push("google");
        return classifyGoogleCalendarDeleteResponse(204);
      },
      deleteMapping: async () => {
        order.push("mapping");
        return true;
      },
    });
    deepStrictEqual(order, ["google", "mapping"]);
    deepStrictEqual(result, { status: "deleted" });
  });

  it("deletes the mapping after 404 but retains it after provider or network failures", async () => {
    let mappingDeletes = 0;
    const missing = await deleteGoogleCalendarMappedEvent({
      deleteGoogleEvent: async () => classifyGoogleCalendarDeleteResponse(404),
      deleteMapping: async () => { mappingDeletes += 1; return true; },
    });
    deepStrictEqual(missing, { status: "already_missing" });
    strictEqual(mappingDeletes, 1);

    for (const status of [401, 403, 429, 500, null]) {
      const failed = await deleteGoogleCalendarMappedEvent({
        deleteGoogleEvent: async () => classifyGoogleCalendarDeleteResponse(status),
        deleteMapping: async () => { mappingDeletes += 1; return true; },
      });
      strictEqual(failed.status, "failed");
    }
    strictEqual(mappingDeletes, 1);
  });

  it("converges after mapping deletion fails because the retry accepts Google 404", async () => {
    const first = await deleteGoogleCalendarMappedEvent({
      deleteGoogleEvent: async () => classifyGoogleCalendarDeleteResponse(204),
      deleteMapping: async () => { throw new Error("Firestore unavailable"); },
    });
    deepStrictEqual(first, { status: "failed", code: "mapping_delete_failed" });

    const second = await deleteGoogleCalendarMappedEvent({
      deleteGoogleEvent: async () => classifyGoogleCalendarDeleteResponse(404),
      deleteMapping: async () => true,
    });
    deepStrictEqual(second, { status: "already_missing" });
  });

  it("blocks active create, update, and delete leases and permits stale takeover", () => {
    const now = 1_000;
    for (const status of ["creating", "updating", "deleting"]) {
      const state = { status, operationId: "operation-a", startedAtMillis: now };
      strictEqual(decideGoogleCalendarEventDeleteLease(
        state,
        now + GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS - 1
      ), "in_progress");
      strictEqual(decideGoogleCalendarEventDeleteLease(
        state,
        now + GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS
      ), "acquire");
    }
  });

  it("accepts completed legacy mappings and allows only the delete lease owner to finish", () => {
    strictEqual(decideGoogleCalendarEventDeleteLease(
      { status: "synced" },
      1_000
    ), "acquire");
    const deleting = {
      status: "deleting",
      operationId: "operation-a",
      startedAtMillis: 1_000,
    };
    strictEqual(ownsGoogleCalendarEventDeleteLease(deleting, "operation-a"), true);
    strictEqual(ownsGoogleCalendarEventDeleteLease(deleting, "operation-b"), false);
    strictEqual(decideGoogleCalendarEventDeleteLease(deleting, 1_000), "in_progress");
  });

  it("continues after partial failures and reports safe aggregate codes", () => {
    deepStrictEqual(summarizeGoogleCalendarDeleteSync([
      { status: "deleted" },
      { status: "failed", code: "event_delete_rate_limited" },
      { status: "already_missing" },
      { status: "deleted" },
    ]), {
      deletedCount: 2,
      alreadyMissingCount: 1,
      failedCount: 1,
      errorCodes: ["event_delete_rate_limited"],
    });
  });
});
