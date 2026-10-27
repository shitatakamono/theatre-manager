import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAttendanceManagementMatrix } from "../lib/attendance-management.ts";
import { findSelfParticipant } from "../lib/attendance-view.ts";
import { buildDashboardAttendanceSummary } from "../lib/project-dashboard.ts";
import {
  buildPersonMigrationDocument,
  buildProjectPersonValues,
  mergePeopleWithParticipantFallback,
  participantToProjectPerson,
  personToParticipantCompat,
} from "../lib/people.ts";

function participant(id, overrides = {}) {
  return {
    id,
    displayName: `参加者${id}`,
    specialPractice: "none",
    linkedUserUid: null,
    publicNote: "",
    active: true,
    createdAt: `created-${id}`,
    updatedAt: `updated-${id}`,
    createdByUid: "owner-a",
    updatedByUid: "editor-a",
    ...overrides,
  };
}

describe("project people values", () => {
  it("reuses participant validation and keeps attendanceTarget independent", () => {
    deepStrictEqual(buildProjectPersonValues({
      displayName: " 田中 太郎 ",
      attendanceTarget: false,
      specialPractice: "stage_combat",
      rehearsalParticipationTypes: ["acting", "stage_combat"],
      linkedUserUid: " user-a ",
      publicNote: " 公開 ",
      active: true,
    }), {
      displayName: "田中 太郎",
      attendanceTarget: false,
      specialPractice: "stage_combat",
      rehearsalParticipationTypes: ["acting", "stage_combat"],
      linkedUserUid: "user-a",
      publicNote: "公開",
      active: true,
    });
    throws(() => buildProjectPersonValues({
      displayName: " ", attendanceTarget: true, specialPractice: "none", linkedUserUid: null, publicNote: "", active: true,
    }), /氏名/);
    throws(() => buildProjectPersonValues({
      displayName: "田中", attendanceTarget: "yes", specialPractice: "none", linkedUserUid: null, publicNote: "", active: true,
    }), /出欠管理対象/);
  });

  it("converts participants with the same ID and preserves metadata", () => {
    const source = participant("participant-a", { active: false, specialPractice: "japanese_dance", linkedUserUid: "viewer-a" });
    const person = participantToProjectPerson(source);
    strictEqual(person.id, "participant-a");
    strictEqual(person.active, false);
    strictEqual(person.attendanceTarget, false);
    strictEqual(person.specialPractice, "japanese_dance");
    strictEqual(person.createdAt, "created-participant-a");
  });
});

describe("people fallback merge", () => {
  it("uses participants as fallback and lets people override only the same ID", () => {
    const participants = [
      participant("a", { displayName: "同姓同名" }),
      participant("b", { displayName: "同姓同名" }),
    ];
    const migrated = {
      ...participantToProjectPerson(participants[0]),
      displayName: "People優先",
      specialPractice: "stage_combat",
    };
    const merged = mergePeopleWithParticipantFallback([migrated], participants);
    strictEqual(merged.length, 2);
    strictEqual(merged.find(({ id }) => id === "a")?.displayName, "People優先");
    strictEqual(merged.find(({ id }) => id === "b")?.displayName, "同姓同名");
  });

  it("adapts attendanceTarget to existing participant-shaped attendance reads", () => {
    const person = {
      ...participantToProjectPerson(participant("a", { linkedUserUid: "viewer-a" })),
      attendanceTarget: false,
      active: true,
    };
    const compat = personToParticipantCompat(person);
    strictEqual(compat.id, "a");
    strictEqual(compat.active, false);
    strictEqual(findSelfParticipant([compat], "viewer-a")?.id, "a");
  });

  it("keeps self lookup and unanswered counts working before and after partial migration", () => {
    const legacyParticipants = [
      participant("a", { linkedUserUid: "viewer-a" }),
      participant("b", { linkedUserUid: "viewer-b" }),
    ];
    const fallback = mergePeopleWithParticipantFallback([], legacyParticipants)
      .map(personToParticipantCompat);
    strictEqual(findSelfParticipant(fallback, "viewer-a")?.id, "a");
    strictEqual(
      buildDashboardAttendanceSummary("project-a", "viewer", "viewer-a", fallback, ["2026-11-15"], []).value,
      "1件"
    );

    const migrated = participantToProjectPerson(legacyParticipants[0]);
    const partialMigration = mergePeopleWithParticipantFallback([migrated], legacyParticipants)
      .map(personToParticipantCompat);
    strictEqual(findSelfParticipant(partialMigration, "viewer-a")?.id, "a");
    strictEqual(
      buildDashboardAttendanceSummary(
        "project-a",
        "viewer",
        "viewer-a",
        partialMigration,
        ["2026-11-15"],
        []
      ).value,
      "1件"
    );
  });

  it("joins existing attendance records by the unchanged person ID", () => {
    const compat = personToParticipantCompat(participantToProjectPerson(participant("participant-a")));
    const records = [{
      id: "2026-11-15_participant-a",
      participantId: "participant-a",
      date: "2026-11-15",
      status: "absent",
      availableFrom: null,
      availableUntil: null,
      publicNote: "",
      createdByUid: "owner-a",
      updatedByUid: "owner-a",
    }];
    const [row] = buildAttendanceManagementMatrix([compat], [{ date: "2026-11-15" }], records);
    strictEqual(row.cells[0].record?.id, "2026-11-15_participant-a");
  });
});

describe("people migration values", () => {
  it("preserves IDs, names, timestamps, and actor metadata", () => {
    const source = participant("participant-a", { displayName: "同姓同名", active: false });
    deepStrictEqual(buildPersonMigrationDocument(source, "migration-owner", "fallback-time"), {
      displayName: "同姓同名",
      attendanceTarget: false,
      specialPractice: "none",
      rehearsalParticipationTypes: ["acting"],
      linkedUserUid: null,
      publicNote: "",
      active: false,
      createdAt: "created-participant-a",
      updatedAt: "updated-participant-a",
      createdByUid: "owner-a",
      updatedByUid: "editor-a",
    });
  });
});
