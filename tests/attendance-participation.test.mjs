import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getAttendanceDayRequirement,
  getAttendanceParticipationMode,
  getSelfAttendanceRehearsals,
  isAttendanceRequiredForRehearsal,
} from "../lib/attendance-participation.ts";

const cast = [
  { id: "cast-a", order: 1, name: "A", personId: "cast-only" },
  { id: "cast-b", order: 2, name: "B", personId: "cast-staff" },
];
const staff = [{ id: "role", role: "演出", members: [
  { id: "staff-a", name: "A", personId: "staff-only" },
  { id: "staff-b", name: "B", personId: "cast-staff" },
] }];

function person(id, rehearsalParticipationTypes, overrides = {}) {
  return {
    id,
    active: true,
    attendanceTarget: true,
    specialPractice: "none",
    rehearsalParticipationTypes,
    ...overrides,
  };
}

function rehearsal(id, type) {
  return { id, type };
}

describe("attendance participation targeting", () => {
  it("requires only selected rehearsal types for cast and other people", () => {
    const acting = rehearsal("acting", "acting");
    const dance = rehearsal("dance", "japanese_dance");
    const combat = rehearsal("combat", "stage_combat");
    const meeting = rehearsal("meeting", "meeting");
    const other = rehearsal("other", "other");

    for (const [selected, expected] of [
      [["acting"], [true, false, false]],
      [["stage_combat"], [false, false, true]],
      [["acting", "stage_combat"], [true, false, true]],
      [["japanese_dance"], [false, true, false]],
    ]) {
      const target = person("cast-only", selected);
      deepStrictEqual(
        [acting, dance, combat].map((item) => isAttendanceRequiredForRehearsal(target, item, cast, staff)),
        expected
      );
      strictEqual(isAttendanceRequiredForRehearsal(target, meeting, cast, staff), false);
      strictEqual(isAttendanceRequiredForRehearsal(target, other, cast, staff), false);
    }

    const unrelated = person("other-person", ["japanese_dance"]);
    strictEqual(isAttendanceRequiredForRehearsal(unrelated, dance, cast, staff), true);
    strictEqual(isAttendanceRequiredForRehearsal(unrelated, acting, cast, staff), false);
  });

  it("keeps cast plus staff on selected required rehearsals", () => {
    const target = person("cast-staff", ["stage_combat"]);
    strictEqual(getAttendanceParticipationMode(target, cast, staff), "required");
    strictEqual(isAttendanceRequiredForRehearsal(target, rehearsal("combat", "stage_combat"), cast, staff), true);
    strictEqual(isAttendanceRequiredForRehearsal(target, rehearsal("acting", "acting"), cast, staff), false);
  });

  it("shows every rehearsal to staff-only people without making unanswered days required", () => {
    const target = person("staff-only", []);
    const rehearsals = [rehearsal("acting", "acting"), rehearsal("meeting", "meeting"), rehearsal("other", "other")];
    strictEqual(getAttendanceParticipationMode(target, cast, staff), "optional_staff");
    deepStrictEqual(getSelfAttendanceRehearsals(target, rehearsals, cast, staff).map(({ id }) => id), ["acting", "meeting", "other"]);
    strictEqual(getAttendanceDayRequirement(target, rehearsals, cast, staff), "optional");
  });

  it("disables self attendance for every role when attendanceTarget is off", () => {
    const rehearsals = [rehearsal("acting", "acting"), rehearsal("meeting", "meeting")];
    for (const target of [
      person("staff-only", [], { attendanceTarget: false }),
      person("cast-only", ["acting"], { attendanceTarget: false }),
      person("other-person", ["acting"], { attendanceTarget: false }),
    ]) {
      strictEqual(getAttendanceParticipationMode(target, cast, staff), "disabled");
      strictEqual(getAttendanceDayRequirement(target, rehearsals, cast, staff), "not_applicable");
      deepStrictEqual(getSelfAttendanceRehearsals(target, rehearsals, cast, staff), []);
    }
  });

  it("uses legacy special-practice compatibility when the new field is absent", () => {
    const legacyNone = person("cast-only", undefined, { specialPractice: "none" });
    const legacyCombat = person("cast-only", undefined, { specialPractice: "stage_combat" });
    const legacyDance = person("cast-only", undefined, { specialPractice: "japanese_dance" });
    strictEqual(isAttendanceRequiredForRehearsal(legacyNone, rehearsal("acting", "acting"), cast, staff), true);
    strictEqual(isAttendanceRequiredForRehearsal(legacyCombat, rehearsal("combat", "stage_combat"), cast, staff), true);
    strictEqual(isAttendanceRequiredForRehearsal(legacyDance, rehearsal("dance", "japanese_dance"), cast, staff), true);
  });
});
