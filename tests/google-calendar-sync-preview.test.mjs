import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { buildGoogleCalendarSyncPreview } from "../lib/google-calendar-sync-preview.ts";

const cast = [{ id: "cast-a", personId: "cast-person", order: 1, name: "キャスト" }];
const staff = [{
  id: "role-a",
  role: "演出",
  members: [{ id: "staff-a", personId: "staff-person", name: "スタッフ" }],
}];

function person(id, categories, active = true) {
  return { id, active, rehearsalParticipationTypes: categories };
}

function rehearsal(rehearsalId, type) {
  return {
    rehearsalId,
    startAt: "2026-11-15T03:00:00.000Z",
    endAt: "2026-11-15T06:00:00.000Z",
    type,
    customType: type === "other" ? "読み合わせ" : "",
    venue: "稽古場",
    content: "稽古",
  };
}

describe("Google Calendar sync preview", () => {
  it("extracts only selected cast rehearsal categories", () => {
    const result = buildGoogleCalendarSyncPreview(
      person("cast-person", ["acting"]),
      [rehearsal("acting-a", "acting"), rehearsal("combat-a", "stage_combat")],
      cast,
      staff
    );
    strictEqual(result.linked, true);
    strictEqual(result.totalRehearsals, 2);
    strictEqual(result.targetCount, 1);
    deepStrictEqual(result.rehearsals.map(({ rehearsalId }) => rehearsalId), ["acting-a"]);
  });

  it("keeps cast-and-staff people on cast category targeting", () => {
    const bothStaff = [{
      id: "role-a",
      role: "演出",
      members: [{ id: "staff-a", personId: "cast-person", name: "兼任" }],
    }];
    const result = buildGoogleCalendarSyncPreview(
      person("cast-person", ["acting"]),
      [rehearsal("acting-a", "acting"), rehearsal("meeting-a", "meeting")],
      cast,
      bothStaff
    );
    deepStrictEqual(result.rehearsals.map(({ rehearsalId }) => rehearsalId), ["acting-a"]);
  });

  it("includes every rehearsal for staff-only people, including meeting and other", () => {
    const rehearsals = [
      rehearsal("acting-a", "acting"),
      rehearsal("dance-a", "japanese_dance"),
      rehearsal("meeting-a", "meeting"),
      rehearsal("other-a", "other"),
    ];
    const result = buildGoogleCalendarSyncPreview(
      person("staff-person", []),
      rehearsals,
      cast,
      staff
    );
    strictEqual(result.targetCount, rehearsals.length);
  });

  it("uses category matching for other people", () => {
    const result = buildGoogleCalendarSyncPreview(
      person("other-person", ["japanese_dance"]),
      [rehearsal("acting-a", "acting"), rehearsal("dance-a", "japanese_dance")],
      cast,
      staff
    );
    deepStrictEqual(result.rehearsals.map(({ rehearsalId }) => rehearsalId), ["dance-a"]);
  });

  it("returns no targets for ended people", () => {
    const result = buildGoogleCalendarSyncPreview(
      person("staff-person", [], false),
      [rehearsal("acting-a", "acting")],
      cast,
      staff
    );
    strictEqual(result.targetCount, 0);
  });

  it("returns an unlinked preview without guessing a person", () => {
    const result = buildGoogleCalendarSyncPreview(
      null,
      [rehearsal("acting-a", "acting")],
      cast,
      staff
    );
    deepStrictEqual(result, {
      linked: false,
      totalRehearsals: 1,
      targetCount: 0,
      rehearsals: [],
    });
  });

  it("passes future category IDs through the existing generic targeting function", () => {
    const result = buildGoogleCalendarSyncPreview(
      person("other-person", ["dance"]),
      [rehearsal("dance-a", "dance"), rehearsal("song-a", "song")],
      cast,
      staff
    );
    deepStrictEqual(result.rehearsals.map(({ rehearsalId }) => rehearsalId), ["dance-a"]);
  });
});
