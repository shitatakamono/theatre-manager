import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGoogleCalendarEventDraft,
  buildGoogleCalendarInitialSyncPlan,
  buildGoogleCalendarMappingSource,
  summarizeGoogleCalendarInitialSync,
} from "../lib/google-calendar-initial-sync.ts";
import { buildGoogleCalendarSyncPreview } from "../lib/google-calendar-sync-preview.ts";

function rehearsal(index, type = "acting") {
  return {
    rehearsalId: `rehearsal-${index}`,
    startAt: `2026-11-${String(index + 1).padStart(2, "0")}T03:00:00.000Z`,
    endAt: `2026-11-${String(index + 1).padStart(2, "0")}T06:00:00.000Z`,
    type,
    customType: type === "other" ? "読み合わせ" : "",
    venue: "稽古場",
    content: "立ち稽古",
    note: "台本持参",
    revision: index,
  };
}

describe("Google Calendar initial sync planning", () => {
  it("plans all 11 targets when no mapping exists", () => {
    const targets = Array.from({ length: 11 }, (_, index) => rehearsal(index));
    const plan = buildGoogleCalendarInitialSyncPlan(targets, new Set());
    strictEqual(plan.totalTargets, 11);
    strictEqual(plan.createTargets.length, 11);
    strictEqual(plan.skippedCount, 0);
  });

  it("skips every rehearsal that already has a mapping", () => {
    const targets = [rehearsal(0), rehearsal(1)];
    const plan = buildGoogleCalendarInitialSyncPlan(
      targets,
      new Set(targets.map(({ rehearsalId }) => rehearsalId))
    );
    strictEqual(plan.createTargets.length, 0);
    strictEqual(plan.skippedCount, 2);
  });

  it("plans only unmapped rehearsals", () => {
    const targets = [rehearsal(0), rehearsal(1), rehearsal(2)];
    const plan = buildGoogleCalendarInitialSyncPlan(
      targets,
      new Set(["rehearsal-1"])
    );
    deepStrictEqual(
      plan.createTargets.map(({ rehearsalId }) => rehearsalId),
      ["rehearsal-0", "rehearsal-2"]
    );
    strictEqual(plan.skippedCount, 1);
  });

  it("does not plan a duplicate rehearsal twice", () => {
    const target = rehearsal(0);
    const plan = buildGoogleCalendarInitialSyncPlan([target, target], new Set());
    strictEqual(plan.totalTargets, 1);
    strictEqual(plan.createTargets.length, 1);
  });

  it("keeps meeting and other in the staff-only targeting used by the plan", () => {
    const cast = [];
    const staff = [{
      id: "role-a",
      role: "演出",
      members: [{ id: "member-a", personId: "staff-person", name: "スタッフ" }],
    }];
    const targets = buildGoogleCalendarSyncPreview(
      { id: "staff-person", active: true, rehearsalParticipationTypes: [] },
      [rehearsal(0, "meeting"), rehearsal(1, "other")],
      cast,
      staff
    ).rehearsals;
    strictEqual(buildGoogleCalendarInitialSyncPlan(targets, new Set()).totalTargets, 2);
  });

  it("plans a future category ID without fixed category branching", () => {
    const targets = buildGoogleCalendarSyncPreview(
      { id: "other-person", active: true, rehearsalParticipationTypes: ["dance"] },
      [rehearsal(0, "dance"), rehearsal(1, "song")],
      [],
      []
    ).rehearsals;
    deepStrictEqual(
      buildGoogleCalendarInitialSyncPlan(targets, new Set()).createTargets
        .map(({ type }) => type),
      ["dance"]
    );
  });

  it("aggregates created and partial failures without rolling back successes", () => {
    deepStrictEqual(summarizeGoogleCalendarInitialSync([
      { status: "created" },
      { status: "failed", code: "event_creation_failed" },
      { status: "created" },
      { status: "failed", code: "event_creation_failed" },
      { status: "failed", code: "missing_end_at" },
    ]), {
      createdCount: 2,
      failedCount: 3,
      errorCodes: ["event_creation_failed", "missing_end_at"],
    });
  });

  it("passes source revision and canonical source values into mapping metadata", () => {
    const target = rehearsal(4, "dance");
    const first = buildGoogleCalendarMappingSource(target);
    const second = buildGoogleCalendarMappingSource({ ...target });
    strictEqual(first.sourceRevision, 4);
    strictEqual(first.sourceHash, second.sourceHash);
  });

  it("builds a private managed event without exposing internal IDs in the description", () => {
    const event = buildGoogleCalendarEventDraft({
      projectId: "project-a",
      projectName: "第61回自主公演",
      categoryLabel: "芝居",
      rehearsal: rehearsal(0),
    });
    strictEqual(event?.summary, "【芝居】第61回自主公演");
    strictEqual(event?.extendedProperties.private.managedBy, "SeisakuBoard");
    strictEqual(event?.description.includes("project-a"), false);
    strictEqual(event?.description.includes("rehearsal-0"), false);
  });

  it("does not invent an end time when endAt is null", () => {
    strictEqual(buildGoogleCalendarEventDraft({
      projectId: "project-a",
      projectName: "第61回自主公演",
      categoryLabel: "芝居",
      rehearsal: { ...rehearsal(0), endAt: null },
    }), null);
  });
});
