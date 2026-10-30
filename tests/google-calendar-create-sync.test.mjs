import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { toGoogleCalendarCreateSyncResult } from "../lib/google-calendar-create-sync.ts";
import {
  buildGoogleCalendarEventDraft,
  buildGoogleCalendarInitialSyncPlan,
  finalizeCreatedGoogleCalendarEvent,
  summarizeGoogleCalendarInitialSync,
} from "../lib/google-calendar-initial-sync.ts";
import {
  decideGoogleCalendarEventLease,
  GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS,
} from "../lib/google-calendar-event-mapping.ts";
import { buildGoogleCalendarSyncPreview } from "../lib/google-calendar-sync-preview.ts";

function rehearsal(index, type = "acting") {
  return {
    rehearsalId: `rehearsal-${index}`,
    startAt: `2026-12-${String(index + 1).padStart(2, "0")}T03:00:00.000Z`,
    endAt: `2026-12-${String(index + 1).padStart(2, "0")}T06:00:00.000Z`,
    type,
    customType: type === "other" ? "読み合わせ" : "",
    venue: "稽古場",
    content: "立ち稽古",
    note: "",
    revision: 1,
  };
}

describe("Google Calendar create sync", () => {
  it("creates only one new rehearsal after eleven existing mappings", () => {
    const rehearsals = Array.from({ length: 12 }, (_, index) => rehearsal(index));
    const mapped = new Set(rehearsals.slice(0, 11).map(({ rehearsalId }) => rehearsalId));
    const plan = buildGoogleCalendarInitialSyncPlan(rehearsals, mapped);
    strictEqual(plan.totalTargets, 12);
    strictEqual(plan.skippedCount, 11);
    deepStrictEqual(plan.createTargets.map(({ rehearsalId }) => rehearsalId), ["rehearsal-11"]);
  });

  it("creates none when every target is already mapped and creates all when none are mapped", () => {
    const rehearsals = [rehearsal(0), rehearsal(1), rehearsal(2)];
    strictEqual(buildGoogleCalendarInitialSyncPlan(
      rehearsals,
      new Set(rehearsals.map(({ rehearsalId }) => rehearsalId))
    ).createTargets.length, 0);
    strictEqual(buildGoogleCalendarInitialSyncPlan(
      rehearsals,
      new Set()
    ).createTargets.length, 3);
  });

  it("uses the shared lease for initial-sync and create-sync concurrency", () => {
    const now = 1_000;
    strictEqual(decideGoogleCalendarEventLease(null, now), "acquire");
    const claimed = {
      status: "creating",
      operationId: "initial-or-create-sync",
      startedAtMillis: now,
    };
    strictEqual(decideGoogleCalendarEventLease(claimed, now), "in_progress");
    strictEqual(decideGoogleCalendarEventLease(
      claimed,
      now + GOOGLE_CALENDAR_EVENT_LEASE_STALE_MS
    ), "acquire");
  });

  it("keeps staff-only meeting and other while cast uses matching categories", () => {
    const rehearsals = [
      rehearsal(0, "acting"),
      rehearsal(1, "meeting"),
      rehearsal(2, "other"),
      rehearsal(3, "stage_combat"),
    ];
    const staff = [{
      id: "role-a",
      role: "演出",
      members: [{ id: "member-a", personId: "staff-person", name: "スタッフ" }],
    }];
    strictEqual(buildGoogleCalendarSyncPreview(
      { id: "staff-person", active: true, rehearsalParticipationTypes: [] },
      rehearsals,
      [],
      staff
    ).targetCount, 4);
    deepStrictEqual(buildGoogleCalendarSyncPreview(
      { id: "cast-person", active: true, rehearsalParticipationTypes: ["stage_combat"] },
      rehearsals,
      [{ id: "cast-a", personId: "cast-person", name: "キャスト" }],
      []
    ).rehearsals.map(({ type }) => type), ["stage_combat"]);
  });

  it("supports a future category ID without branching", () => {
    const targets = buildGoogleCalendarSyncPreview(
      { id: "person-a", active: true, rehearsalParticipationTypes: ["dance"] },
      [rehearsal(0, "dance"), rehearsal(1, "song")],
      [],
      []
    ).rehearsals;
    deepStrictEqual(targets.map(({ type }) => type), ["dance"]);
  });

  it("keeps missing end time and partial failure behavior from the shared core", () => {
    strictEqual(buildGoogleCalendarEventDraft({
      projectId: "project-a",
      projectName: "公演",
      categoryLabel: "芝居",
      rehearsal: { ...rehearsal(0), endAt: null },
    }), null);
    deepStrictEqual(summarizeGoogleCalendarInitialSync([
      { status: "created" },
      { status: "failed", code: "mapping_save_cleanup_failed" },
      { status: "created" },
    ]), {
      createdCount: 2,
      failedCount: 1,
      errorCodes: ["mapping_save_cleanup_failed"],
    });
  });

  it("cleans up the Google event when mapping persistence fails", async () => {
    let cleanupCalls = 0;
    let releaseCalls = 0;
    const result = await finalizeCreatedGoogleCalendarEvent({
      completeMapping: async () => { throw new Error("save failed"); },
      cleanupEvent: async () => { cleanupCalls += 1; return true; },
      releaseLease: async () => { releaseCalls += 1; },
    });
    deepStrictEqual(result, { completed: false, code: "mapping_save_failed" });
    strictEqual(cleanupCalls, 1);
    strictEqual(releaseCalls, 1);
  });

  it("cleans up a created event when the creation lease was lost", async () => {
    let cleanupCalls = 0;
    const result = await finalizeCreatedGoogleCalendarEvent({
      completeMapping: async () => false,
      cleanupEvent: async () => { cleanupCalls += 1; return false; },
      releaseLease: async () => { throw new Error("must not release another lease"); },
    });
    deepStrictEqual(result, {
      completed: false,
      code: "event_lease_lost_cleanup_failed",
    });
    strictEqual(cleanupCalls, 1);
  });

  it("reports existing mappings and makes reruns create nothing", () => {
    deepStrictEqual(toGoogleCalendarCreateSyncResult({
      success: true,
      totalTargets: 12,
      createdCount: 1,
      skippedCount: 11,
      failedCount: 0,
      errorCodes: [],
    }), {
      success: true,
      targetCount: 12,
      existingCount: 11,
      createdCount: 1,
      failedCount: 0,
      errorCodes: [],
    });
    const targets = [rehearsal(0), rehearsal(1)];
    strictEqual(buildGoogleCalendarInitialSyncPlan(
      targets,
      new Set(targets.map(({ rehearsalId }) => rehearsalId))
    ).createTargets.length, 0);
  });
});
