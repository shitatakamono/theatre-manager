import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGoogleCalendarReconcileSyncPlan,
  combineGoogleCalendarReconcileResults,
  runGoogleCalendarReconcileOperations,
} from "../lib/google-calendar-reconcile-sync.ts";
import { buildGoogleCalendarSyncPreview } from "../lib/google-calendar-sync-preview.ts";
import {
  decideGoogleCalendarEventDeleteLease,
  decideGoogleCalendarEventLease,
  GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS,
} from "../lib/google-calendar-event-mapping.ts";

function rehearsal(rehearsalId, type) {
  return {
    rehearsalId,
    type,
    startAt: "2026-12-01T03:00:00.000Z",
    endAt: "2026-12-01T06:00:00.000Z",
    customType: "",
    venue: "稽古場",
    content: "稽古",
    note: "",
    revision: 1,
  };
}

function mapping(rehearsalId, projectId = "project-a") {
  return { projectId, rehearsalId };
}

function desiredFor(person, rehearsals, cast = [], staff = []) {
  return buildGoogleCalendarSyncPreview(
    person,
    rehearsals,
    cast,
    staff
  ).rehearsals;
}

const cast = [{ id: "cast-a", personId: "person-a", name: "キャスト" }];
const staff = [{
  id: "staff-role",
  role: "演出",
  members: [{ id: "staff-a", personId: "person-a", name: "スタッフ" }],
}];

describe("Google Calendar reconcile sync", () => {
  it("builds a plan from the same 22/15/11 array shape used by the server", () => {
    const allRehearsals = Array.from(
      { length: 22 },
      (_, index) => rehearsal(`rehearsal-${index + 1}`, "acting")
    );
    const desiredRehearsals = allRehearsals.slice(0, 15);
    const mappings = allRehearsals.slice(0, 11).map(
      ({ rehearsalId }) => mapping(rehearsalId)
    );
    const plan = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals,
      desiredRehearsals,
      mappings,
    });

    strictEqual(plan.totalRehearsals, 22);
    strictEqual(plan.desiredCount, 15);
    strictEqual(plan.mappedCount, 11);
    deepStrictEqual(
      plan.createTargets.map(({ rehearsalId }) => rehearsalId),
      ["rehearsal-12", "rehearsal-13", "rehearsal-14", "rehearsal-15"]
    );
    strictEqual(plan.deleteTargets.length, 0);
  });

  it("separates growing, shrinking, and removed-rehearsal differences", () => {
    const acting = rehearsal("acting-a", "acting");
    const dance = rehearsal("dance-a", "dance");
    const meeting = rehearsal("meeting-a", "meeting");
    const growing = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: [acting, dance, meeting],
      desiredRehearsals: [acting, dance],
      mappings: [mapping("acting-a")],
    });
    deepStrictEqual(
      growing.createTargets.map(({ rehearsalId }) => rehearsalId),
      ["dance-a"]
    );

    const shrinking = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: [acting, dance, meeting],
      desiredRehearsals: [acting],
      mappings: [mapping("acting-a"), mapping("dance-a"), mapping("removed-a")],
    });
    deepStrictEqual(
      shrinking.deleteTargets.map(({ rehearsalId }) => rehearsalId),
      ["dance-a"]
    );
  });

  it("keeps an existing acting mapping and does nothing else", () => {
    const rehearsals = [rehearsal("acting-a", "acting"), rehearsal("dance-a", "dance")];
    const desired = desiredFor(
      { id: "person-a", active: true, rehearsalParticipationTypes: ["acting"] },
      rehearsals,
      cast
    );
    const plan = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: desired,
      mappings: [mapping("acting-a")],
    });
    strictEqual(plan.desiredCount, 1);
    strictEqual(plan.createTargets.length, 0);
    strictEqual(plan.deleteTargets.length, 0);
  });

  it("adds dance when cast participation expands from acting to acting plus dance", () => {
    const rehearsals = [rehearsal("acting-a", "acting"), rehearsal("dance-a", "dance")];
    const desired = desiredFor(
      { id: "person-a", active: true, rehearsalParticipationTypes: ["acting", "dance"] },
      rehearsals,
      cast
    );
    const plan = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: desired,
      mappings: [mapping("acting-a")],
    });
    deepStrictEqual(plan.createTargets.map(({ rehearsalId }) => rehearsalId), ["dance-a"]);
    strictEqual(plan.deleteTargets.length, 0);
  });

  it("deletes dance when cast participation contracts to acting only", () => {
    const rehearsals = [rehearsal("acting-a", "acting"), rehearsal("dance-a", "dance")];
    const desired = desiredFor(
      { id: "person-a", active: true, rehearsalParticipationTypes: ["acting"] },
      rehearsals,
      cast
    );
    const plan = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: desired,
      mappings: [mapping("acting-a"), mapping("dance-a")],
    });
    strictEqual(plan.createTargets.length, 0);
    deepStrictEqual(plan.deleteTargets.map(({ rehearsalId }) => rehearsalId), ["dance-a"]);
  });

  it("handles staff-only to cast and cast to staff-only role changes", () => {
    const rehearsals = [
      rehearsal("acting-a", "acting"),
      rehearsal("meeting-a", "meeting"),
      rehearsal("other-a", "other"),
    ];
    const person = { id: "person-a", active: true, rehearsalParticipationTypes: ["acting"] };
    const staffDesired = desiredFor(person, rehearsals, [], staff);
    strictEqual(staffDesired.length, 3);
    const toStaff = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: staffDesired,
      mappings: [mapping("acting-a")],
    });
    deepStrictEqual(
      toStaff.createTargets.map(({ rehearsalId }) => rehearsalId),
      ["meeting-a", "other-a"]
    );

    const castDesired = desiredFor(person, rehearsals, cast, []);
    const toCast = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: castDesired,
      mappings: rehearsals.map(({ rehearsalId }) => mapping(rehearsalId)),
    });
    deepStrictEqual(
      toCast.deleteTargets.map(({ rehearsalId }) => rehearsalId),
      ["meeting-a", "other-a"]
    );
  });

  it("makes every existing mapping a delete target when the linked person is inactive", () => {
    const rehearsals = [rehearsal("acting-a", "acting"), rehearsal("dance-a", "dance")];
    const desired = desiredFor(
      { id: "person-a", active: false, rehearsalParticipationTypes: ["acting", "dance"] },
      rehearsals,
      cast
    );
    const plan = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: desired,
      mappings: rehearsals.map(({ rehearsalId }) => mapping(rehearsalId)),
    });
    strictEqual(desired.length, 0);
    strictEqual(plan.deleteTargets.length, 2);
  });

  it("supports future categories and ignores attendance-only values", () => {
    const rehearsals = [rehearsal("dance-a", "dance")];
    const base = { id: "person-a", active: true, rehearsalParticipationTypes: ["dance"] };
    const enabled = desiredFor(
      { ...base, attendanceTarget: true, attendanceRecords: [{ status: "absent" }] },
      rehearsals,
      cast
    );
    const disabled = desiredFor(
      { ...base, attendanceTarget: false, attendanceRecords: [] },
      rehearsals,
      cast
    );
    deepStrictEqual(enabled, disabled);
    strictEqual(enabled[0].type, "dance");
  });

  it("leaves deleted rehearsal mappings to G3-3 and ignores unmapped non-targets", () => {
    const acting = rehearsal("acting-a", "acting");
    const dance = rehearsal("dance-a", "dance");
    const plan = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: [acting, dance],
      desiredRehearsals: [acting],
      mappings: [mapping("acting-a"), mapping("removed-a")],
    });
    strictEqual(plan.createTargets.length, 0);
    strictEqual(plan.deleteTargets.length, 0);
  });

  it("keeps another project untouched", () => {
    const acting = rehearsal("acting-a", "acting");
    const plan = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: [acting],
      desiredRehearsals: [],
      mappings: [mapping("acting-a", "project-b")],
    });
    strictEqual(plan.mappedCount, 0);
    strictEqual(plan.deleteTargets.length, 0);
  });

  it("aggregates create and delete partial failures without rolling back successes", () => {
    deepStrictEqual(combineGoogleCalendarReconcileResults({
      creation: {
        createdCount: 1,
        failedCount: 1,
        errorCodes: ["event_creation_failed"],
      },
      deletion: {
        deletedCount: 2,
        alreadyMissingCount: 1,
        failedCount: 1,
        errorCodes: ["event_delete_rate_limited"],
      },
    }), {
      createdCount: 1,
      deletedCount: 2,
      alreadyMissingCount: 1,
      failedCount: 2,
      errorCodes: ["event_creation_failed", "event_delete_rate_limited"],
    });
  });

  it("continues deletion after create failures and preserves create successes after delete failures", async () => {
    const calls = [];
    const result = await runGoogleCalendarReconcileOperations({
      create: async () => {
        calls.push("create");
        return {
          createdCount: 1,
          failedCount: 1,
          errorCodes: ["event_creation_failed"],
        };
      },
      delete: async () => {
        calls.push("delete");
        return {
          deletedCount: 1,
          alreadyMissingCount: 0,
          failedCount: 1,
          errorCodes: ["event_delete_provider_failed"],
        };
      },
    });
    deepStrictEqual(calls, ["create", "delete"]);
    strictEqual(result.createdCount, 1);
    strictEqual(result.deletedCount, 1);
    strictEqual(result.failedCount, 2);
  });

  it("passes a four-mapping delete plan through the reconcile deletion path", async () => {
    const rehearsals = Array.from(
      { length: 4 },
      (_, index) => rehearsal(`delete-${index + 1}`, "stage_combat")
    );
    const plan = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: [],
      mappings: rehearsals.map(({ rehearsalId }) => mapping(rehearsalId)),
    });
    let receivedDeleteTargets = 0;
    const result = await runGoogleCalendarReconcileOperations({
      create: async () => ({
        createdCount: 0,
        failedCount: 0,
        errorCodes: [],
      }),
      delete: async () => {
        receivedDeleteTargets = plan.deleteTargets.length;
        return {
          deletedCount: plan.deleteTargets.length,
          alreadyMissingCount: 0,
          failedCount: 0,
          errorCodes: [],
        };
      },
    });

    strictEqual(receivedDeleteTargets, 4);
    strictEqual(result.deletedCount, 4);
    strictEqual(result.failedCount, 0);
  });

  it("reuses creation and deletion lease semantics for concurrency and stale recovery", () => {
    const now = 1_000;
    strictEqual(decideGoogleCalendarEventLease({
      status: "creating",
      operationId: "create-a",
      startedAtMillis: now,
    }, now), "in_progress");
    strictEqual(decideGoogleCalendarEventDeleteLease({
      status: "deleting",
      operationId: "delete-a",
      startedAtMillis: now,
    }, now), "in_progress");
    strictEqual(decideGoogleCalendarEventDeleteLease({
      status: "updating",
      operationId: "update-a",
      startedAtMillis: now,
    }, now + GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS), "acquire");
  });

  it("returns an unlinked state without guessing identity", () => {
    const preview = buildGoogleCalendarSyncPreview(
      null,
      [rehearsal("acting-a", "acting")],
      cast,
      staff
    );
    strictEqual(preview.linked, false);
    strictEqual(preview.targetCount, 0);
  });

  it("converges on rerun after mappings match the desired set", () => {
    const rehearsals = [rehearsal("acting-a", "acting"), rehearsal("dance-a", "dance")];
    const first = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: rehearsals,
      mappings: [mapping("acting-a")],
    });
    strictEqual(first.createTargets.length, 1);
    const rerun = buildGoogleCalendarReconcileSyncPlan({
      projectId: "project-a",
      allRehearsals: rehearsals,
      desiredRehearsals: rehearsals,
      mappings: [mapping("acting-a"), mapping("dance-a")],
    });
    strictEqual(rerun.createTargets.length, 0);
    strictEqual(rerun.deleteTargets.length, 0);
  });
});
