import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildGoogleCalendarEventDraft,
  buildGoogleCalendarMappingSource,
} from "../lib/google-calendar-initial-sync.ts";
import {
  buildGoogleCalendarCompletedUpdate,
  buildGoogleCalendarUpdateSyncPlan,
  googleEventUpdateErrorCode,
  summarizeGoogleCalendarUpdateSync,
} from "../lib/google-calendar-update-sync.ts";

function rehearsal(overrides = {}) {
  return {
    rehearsalId: "rehearsal-a",
    startAt: "2026-11-15T03:00:00.000Z",
    endAt: "2026-11-15T06:00:00.000Z",
    type: "acting",
    customType: "",
    venue: "稽古場",
    content: "立ち稽古",
    note: "台本持参",
    revision: 1,
    ...overrides,
  };
}

function mapping(sourceRehearsal = rehearsal()) {
  const source = buildGoogleCalendarMappingSource(sourceRehearsal);
  return {
    status: "synced",
    projectId: "project-a",
    rehearsalId: sourceRehearsal.rehearsalId,
    calendarId: "private-calendar",
    googleEventId: "private-event",
    sourceRevision: source.sourceRevision,
    sourceHash: source.sourceHash,
    lastSyncedAt: null,
    lastErrorCode: null,
    createdAt: {},
    updatedAt: {},
  };
}

describe("Google Calendar update sync", () => {
  it("does not update when the canonical source hash is unchanged", () => {
    const current = rehearsal();
    const plan = buildGoogleCalendarUpdateSyncPlan([mapping(current)], [current]);
    strictEqual(plan.mappedCount, 1);
    strictEqual(plan.unchangedCount, 1);
    strictEqual(plan.updateTargets.length, 0);
  });

  for (const [label, change] of [
    ["date/time", { startAt: "2026-11-15T04:00:00.000Z" }],
    ["venue", { venue: "別会場" }],
    ["content", { content: "通し稽古" }],
    ["note", { note: "衣装持参" }],
    ["category ID", { type: "stage_combat" }],
  ]) {
    it(`plans an update after a ${label} change`, () => {
      const before = rehearsal();
      const after = rehearsal({ ...change, revision: 2 });
      const plan = buildGoogleCalendarUpdateSyncPlan([mapping(before)], [after]);
      strictEqual(plan.updateTargets.length, 1);
      notStrictEqual(plan.updateTargets[0].sourceHash, mapping(before).sourceHash);
    });
  }

  it("builds the shared payload for a future category and overwrites Google values", () => {
    const current = rehearsal({ type: "dance", customType: "ダンス", venue: "新会場" });
    const event = buildGoogleCalendarEventDraft({
      projectId: "project-a",
      projectName: "公演名",
      categoryLabel: current.customType,
      rehearsal: current,
    });
    strictEqual(event?.summary, "【ダンス】公演名");
    strictEqual(event?.location, "新会場");
    strictEqual(event?.description.includes("立ち稽古"), true);
    strictEqual(event?.extendedProperties.private.rehearsalId, "rehearsal-a");
  });

  it("does not infer an end time", () => {
    strictEqual(buildGoogleCalendarEventDraft({
      projectId: "project-a",
      projectName: "公演名",
      categoryLabel: "芝居",
      rehearsal: rehearsal({ endAt: null }),
    }), null);
  });

  it("classifies Google 404 without recreating the event", () => {
    strictEqual(googleEventUpdateErrorCode(404), "google_event_not_found");
    strictEqual(googleEventUpdateErrorCode(500), "event_update_failed");
    strictEqual(googleEventUpdateErrorCode(null), "event_update_failed");
  });

  it("builds the mapping completion fields with the new revision and hash", () => {
    deepStrictEqual(buildGoogleCalendarCompletedUpdate({
      sourceRevision: 7,
      sourceHash: "new-hash",
      lastSyncedAt: "now",
    }), {
      sourceRevision: 7,
      sourceHash: "new-hash",
      lastSyncedAt: "now",
      lastErrorCode: null,
    });
  });

  it("continues aggregation after partial failures", () => {
    deepStrictEqual(summarizeGoogleCalendarUpdateSync([
      { status: "updated" },
      { status: "failed", code: "google_event_not_found" },
      { status: "updated" },
      { status: "unchanged" },
    ]), {
      updatedCount: 2,
      unchangedCount: 1,
      failedCount: 1,
      errorCodes: ["google_event_not_found"],
    });
  });
});
