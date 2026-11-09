import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  didGoogleCalendarParticipationFieldsChange,
  didGoogleCalendarPersonLinkChange,
  didGoogleCalendarRelevantRehearsalFieldsChange,
  didProjectCastStaffEligibilityChange,
  enqueueGoogleCalendarSyncForUids,
  planGoogleCalendarLinkedUserTrigger,
  planGoogleCalendarPersonTriggers,
  planGoogleCalendarRehearsalTrigger,
} from "../lib/google-calendar-sync-triggers.ts";
import {
  planGoogleCalendarSyncJobEnqueue,
} from "../lib/google-calendar-sync-job.ts";

describe("Google Calendar trigger change detection", () => {
  it("plans create for normal users and delete for mapping owners", () => {
    deepStrictEqual(planGoogleCalendarRehearsalTrigger("create"), {
      audience: "normal",
      reason: "rehearsal_created",
    });
    deepStrictEqual(planGoogleCalendarRehearsalTrigger("delete"), {
      audience: "mapping_owners",
      reason: "rehearsal_deleted",
    });
  });

  for (const field of [
    "startAt",
    "endAt",
    "type",
    "customType",
    "venue",
    "content",
    "note",
  ]) {
    it(`enqueues rehearsal update when ${field} changes`, () => {
      const before = { [field]: "before", updatedAt: 1, revision: 1 };
      const after = { [field]: "after", updatedAt: 2, revision: 2 };
      strictEqual(
        didGoogleCalendarRelevantRehearsalFieldsChange(before, after),
        true
      );
      strictEqual(
        planGoogleCalendarRehearsalTrigger("update", before, after)?.reason,
        "rehearsal_updated"
      );
    });
  }

  it("ignores revision, audit, and timestamp-only rehearsal updates", () => {
    const common = {
      startAt: "2026-11-01T10:00:00+09:00",
      endAt: "2026-11-01T12:00:00+09:00",
      type: "acting",
      customType: "",
      venue: "Studio",
      content: "Scene 1",
      note: "",
    };
    strictEqual(didGoogleCalendarRelevantRehearsalFieldsChange(
      { ...common, revision: 1, updatedAt: 1, updatedByUid: "a" },
      { ...common, revision: 2, updatedAt: 2, updatedByUid: "b" }
    ), false);
  });

  it("compares Firestore-like timestamps by milliseconds", () => {
    const timestamp = (millis) => ({ toMillis: () => millis });
    strictEqual(didGoogleCalendarRelevantRehearsalFieldsChange(
      { startAt: timestamp(1000) },
      { startAt: timestamp(1000) }
    ), false);
    strictEqual(didGoogleCalendarRelevantRehearsalFieldsChange(
      { startAt: timestamp(1000) },
      { startAt: timestamp(2000) }
    ), true);
  });

  it("detects participation and active changes but ignores attendanceTarget", () => {
    strictEqual(didGoogleCalendarParticipationFieldsChange(
      { rehearsalParticipationTypes: ["acting"], active: true },
      { rehearsalParticipationTypes: ["acting", "dance"], active: true }
    ), true);
    strictEqual(didGoogleCalendarParticipationFieldsChange(
      { rehearsalParticipationTypes: ["acting"], active: true },
      { rehearsalParticipationTypes: ["acting"], active: false }
    ), true);
    strictEqual(didGoogleCalendarParticipationFieldsChange(
      { rehearsalParticipationTypes: ["acting"], active: true, attendanceTarget: false },
      { rehearsalParticipationTypes: ["acting"], active: true, attendanceTarget: true }
    ), false);
    deepStrictEqual(planGoogleCalendarPersonTriggers(
      { linkedUserUid: "user-a", active: true, attendanceTarget: false },
      { linkedUserUid: "user-a", active: false, attendanceTarget: false }
    ), [{ uid: "user-a", reason: "participation_changed" }]);
    deepStrictEqual(planGoogleCalendarPersonTriggers(
      { linkedUserUid: "user-a", active: true, attendanceTarget: false },
      { linkedUserUid: "user-a", active: true, attendanceTarget: true }
    ), []);
  });

  it("enqueues only the new linked UID and never the removed UID", () => {
    strictEqual(didGoogleCalendarPersonLinkChange(
      { linkedUserUid: "old-user" },
      { linkedUserUid: "new-user" }
    ), true);
    deepStrictEqual(planGoogleCalendarPersonTriggers(
      { linkedUserUid: "old-user", active: true },
      { linkedUserUid: "new-user", active: true }
    ), [{ uid: "new-user", reason: "person_changed" }]);
    deepStrictEqual(planGoogleCalendarPersonTriggers(
      { linkedUserUid: "old-user", active: true },
      { linkedUserUid: null, active: true }
    ), []);
    deepStrictEqual(planGoogleCalendarPersonTriggers(
      { linkedUserUid: null, active: true },
      { linkedUserUid: "new-user", active: true }
    ), [{ uid: "new-user", reason: "person_changed" }]);
  });

  it("plans participation changes only for the currently linked UID", () => {
    deepStrictEqual(planGoogleCalendarPersonTriggers(
      {
        linkedUserUid: "user-a",
        active: true,
        rehearsalParticipationTypes: ["acting"],
      },
      {
        linkedUserUid: "user-a",
        active: true,
        rehearsalParticipationTypes: ["acting", "dance"],
      }
    ), [{ uid: "user-a", reason: "participation_changed" }]);
  });

  it("plans participant link create and reassignment, but not deletion", () => {
    deepStrictEqual(planGoogleCalendarLinkedUserTrigger({
      uid: "user-a",
      afterParticipantId: "person-a",
    }), [{ uid: "user-a", reason: "link_changed" }]);
    deepStrictEqual(planGoogleCalendarLinkedUserTrigger({
      uid: "user-a",
      beforeParticipantId: "person-a",
      afterParticipantId: "person-b",
    }), [{ uid: "user-a", reason: "link_changed" }]);
    deepStrictEqual(planGoogleCalendarLinkedUserTrigger({
      uid: "user-a",
      beforeParticipantId: "person-a",
    }), []);
  });

  it("detects cast and staff eligibility by personId while ignoring display order", () => {
    const before = {
      cast: [
        { personId: "person-a", order: 1, displayName: "A" },
        { personId: "person-b", order: 2, displayName: "B" },
      ],
      staff: [{ role: "演出", members: [{ personId: "person-c", order: 1, name: "C" }] }],
    };
    const reordered = {
      cast: [
        { personId: "person-b", order: 1, displayName: "B2" },
        { personId: "person-a", order: 2, displayName: "A2" },
      ],
      staff: [{ role: "Director", order: 99, members: [{ personId: "person-c", order: 99, name: "C2" }] }],
    };
    strictEqual(didProjectCastStaffEligibilityChange(before, reordered), false);
    strictEqual(didProjectCastStaffEligibilityChange(
      { ...before, performanceName: "Before" },
      { ...before, performanceName: "After" }
    ), false);
    strictEqual(didProjectCastStaffEligibilityChange(before, {
      ...reordered,
      cast: [...reordered.cast, { personId: "person-d", order: 3 }],
    }), true);
    strictEqual(didProjectCastStaffEligibilityChange(before, {
      ...before,
      cast: before.cast.slice(0, 1),
    }), true);
    strictEqual(didProjectCastStaffEligibilityChange(before, {
      ...reordered,
      staff: [...reordered.staff, {
        role: "舞台監督",
        members: [{ personId: "person-d" }],
      }],
    }), true);
    strictEqual(didProjectCastStaffEligibilityChange(before, {
      ...before,
      staff: [],
    }), true);
  });
});

describe("Google Calendar trigger fan-out", () => {
  it("deduplicates and deterministically orders multiple UIDs", async () => {
    const calls = [];
    const result = await enqueueGoogleCalendarSyncForUids({
      projectId: "project-a",
      uids: ["user-b", "user-a", "user-b", ""],
      reason: "rehearsal_created",
      enqueue: async (request) => calls.push(request),
    });
    deepStrictEqual(calls.map(({ uid }) => uid), ["user-a", "user-b"]);
    deepStrictEqual(result, {
      requestedCount: 2,
      enqueuedCount: 2,
      failedCount: 0,
      errorCodes: [],
    });
  });

  it("continues other UIDs and returns only a safe code after one failure", async () => {
    const calls = [];
    const result = await enqueueGoogleCalendarSyncForUids({
      projectId: "project-a",
      uids: ["mapping-owner", "user-b", "user-a"],
      reason: "rehearsal_deleted",
      enqueue: async (request) => {
        calls.push(request.uid);
        if (request.uid === "mapping-owner") {
          throw new Error("secret calendar and event identifiers");
        }
      },
    });
    deepStrictEqual(calls, ["mapping-owner", "user-a", "user-b"]);
    deepStrictEqual(result, {
      requestedCount: 3,
      enqueuedCount: 2,
      failedCount: 1,
      errorCodes: ["sync_job_enqueue_failed"],
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "token",
      "secret",
      "calendarId",
      "eventId",
      "mapping-owner",
    ]) {
      strictEqual(serialized.includes(forbidden), false);
    }
  });

  it("handles an empty audience without writes", async () => {
    let calls = 0;
    const result = await enqueueGoogleCalendarSyncForUids({
      projectId: "project-a",
      uids: [],
      reason: "cast_staff_changed",
      enqueue: async () => { calls += 1; },
    });
    strictEqual(calls, 0);
    strictEqual(result.requestedCount, 0);
  });

  it("enqueues a mapping-owner-only deletion audience", async () => {
    const calls = [];
    const result = await enqueueGoogleCalendarSyncForUids({
      projectId: "project-a",
      uids: ["removed-member-mapping-owner"],
      reason: "rehearsal_deleted",
      enqueue: async (request) => calls.push(request),
    });
    deepStrictEqual(calls, [{
      uid: "removed-member-mapping-owner",
      projectId: "project-a",
      reason: "rehearsal_deleted",
    }]);
    strictEqual(result.enqueuedCount, 1);
  });

  it("coalesces duplicate at-least-once deliveries through the G3-5A planner", () => {
    const input = {
      uid: "user-a",
      projectId: "project-a",
      reason: "rehearsal_updated",
    };
    const first = planGoogleCalendarSyncJobEnqueue(null, input);
    const state = planGoogleCalendarSyncJobEnqueue(first, input);
    deepStrictEqual(state?.reasons, ["rehearsal_updated"]);
    strictEqual(state?.generation, 2);
    strictEqual(state?.status, "pending");
  });
});
