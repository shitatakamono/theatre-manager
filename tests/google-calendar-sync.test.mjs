import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldSyncRehearsalForPerson } from "../lib/google-calendar-sync.ts";

const cast = [{
  id: "cast-a",
  personId: "cast-person",
  order: 1,
  name: "キャスト",
}];

const staff = [{
  id: "staff-role",
  role: "演出",
  members: [{ id: "staff-a", personId: "staff-person", name: "スタッフ" }],
}];

function person(id, categories, overrides = {}) {
  return {
    id,
    active: true,
    rehearsalParticipationTypes: categories,
    ...overrides,
  };
}

function rehearsal(type) {
  return { type };
}

describe("Google Calendar rehearsal sync targeting", () => {
  it("syncs a cast rehearsal only when its category is selected", () => {
    const target = person("cast-person", ["acting"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("stage_combat"), cast, staff), false);
  });

  it("supports multiple selected categories for cast", () => {
    const target = person("cast-person", ["acting", "stage_combat"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("stage_combat"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("japanese_dance"), cast, staff), false);
  });

  it("keeps a cast-and-staff person on cast category targeting", () => {
    const bothStaff = [{
      id: "staff-role",
      role: "演出",
      members: [{ id: "staff-a", personId: "cast-person", name: "兼任" }],
    }];
    const target = person("cast-person", ["acting"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, bothStaff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("meeting"), cast, bothStaff), false);
  });

  it("syncs every category for staff-only people", () => {
    const target = person("staff-person", []);
    for (const type of ["acting", "japanese_dance", "meeting", "other"]) {
      strictEqual(shouldSyncRehearsalForPerson(target, rehearsal(type), cast, staff), true);
    }
  });

  it("uses category matching for other people and rejects an empty selection", () => {
    const target = person("other-person", ["japanese_dance"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("japanese_dance"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, staff), false);
    strictEqual(shouldSyncRehearsalForPerson(person("other-person", []), rehearsal("acting"), cast, staff), false);
    strictEqual(shouldSyncRehearsalForPerson(person("other-person", undefined), rehearsal("acting"), cast, staff), false);
  });

  it("does not sync ended people", () => {
    const target = person("staff-person", [], { active: false });
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("acting"), cast, staff), false);
  });

  it("does not depend on attendanceTarget or attendance records", () => {
    const enabled = person("cast-person", ["acting"], { attendanceTarget: true });
    const disabled = person("cast-person", ["acting"], { attendanceTarget: false });
    strictEqual(shouldSyncRehearsalForPerson(enabled, rehearsal("acting"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(disabled, rehearsal("acting"), cast, staff), true);
  });

  it("matches a future custom category ID without fixed category branching", () => {
    const target = person("other-person", ["dance"]);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("dance"), cast, staff), true);
    strictEqual(shouldSyncRehearsalForPerson(target, rehearsal("song"), cast, staff), false);
  });
});
