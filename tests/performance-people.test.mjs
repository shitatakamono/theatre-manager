import { deepStrictEqual, match, strictEqual, throws } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  buildNewPerformancePerson,
  getCastPersonIds,
  getSelectablePerformancePeople,
  getStaffPersonIds,
  preparePerformancePeopleForSave,
  resolveCastMemberPerson,
  resolveStaffMemberPerson,
} from "../lib/performance-people.ts";
import { getNextStaffMemberOrder, moveStaffMember, sortStaffMembers } from "../lib/performance.ts";

const people = [{
  id: "person-a",
  displayName: "人物マスタ名",
  attendanceTarget: true,
  specialPractice: "stage_combat",
  linkedUserUid: null,
  publicNote: "",
  active: true,
  createdByUid: "owner-a",
  updatedByUid: "owner-a",
}];

describe("performance people linking", () => {
  it("keeps legacy staff order stable and applies explicit order within each role", () => {
    const legacy = [
      { id: "staff-a", name: "A" },
      { id: "staff-b", name: "B" },
      { id: "staff-c", name: "C" },
    ];
    deepStrictEqual(sortStaffMembers(legacy).map(({ id }) => id), ["staff-a", "staff-b", "staff-c"]);
    deepStrictEqual(sortStaffMembers([
      { ...legacy[0], order: 2 },
      legacy[1],
      { ...legacy[2], order: 1 },
    ]).map(({ id }) => id), ["staff-c", "staff-a", "staff-b"]);
    strictEqual(getNextStaffMemberOrder([{ ...legacy[0], order: 10 }, legacy[1]]), 11);
  });

  it("moves staff only inside the selected role and normalizes that role atomically", () => {
    const staff = [
      { id: "role-a", role: "演出", members: [
        { id: "staff-a", name: "A" },
        { id: "staff-b", name: "B" },
        { id: "staff-c", name: "C" },
      ] },
      { id: "role-b", role: "制作", members: [{ id: "staff-d", name: "D" }] },
    ];
    const moved = moveStaffMember(staff, "role-a", "staff-c", "up");
    deepStrictEqual(moved[0].members.map(({ id, order }) => [id, order]), [
      ["staff-a", 1], ["staff-c", 2], ["staff-b", 3],
    ]);
    strictEqual(moved[1], staff[1]);
    strictEqual(moveStaffMember(moved, "role-a", "staff-a", "up")[0], moved[0]);
    strictEqual(moveStaffMember(moved, "role-a", "staff-b", "down")[0], moved[0]);
  });

  it("exposes accessible up/down controls while the existing editor remains permission-gated", async () => {
    const source = await readFile(
      new URL("../app/projects/[projectId]/info/PerformanceInfoClient.tsx", import.meta.url),
      "utf8"
    );
    match(source, /aria-label="上へ移動"/);
    match(source, /aria-label="下へ移動"/);
    match(source, /disabled=\{saving \|\| memberIndex === 0\}/);
    match(source, /\{canEdit && <button className=\{styles\.editButton\}/);
  });

  it("hides ended people from new selections while keeping an existing ended selection", () => {
    const ended = { ...people[0], id: "ended", active: false };
    deepStrictEqual(getSelectablePerformancePeople([...people, ended]).map(({ id }) => id), ["person-a"]);
    deepStrictEqual(getSelectablePerformancePeople([...people, ended], "ended").map(({ id }) => id), ["person-a", "ended"]);
  });

  it("resolves only an explicit personId and never matches by name", () => {
    strictEqual(resolveCastMemberPerson({ id: "cast-a", order: 1, name: "人物マスタ名" }, people).person, null);
    strictEqual(resolveCastMemberPerson({ id: "cast-a", order: 1, name: "旧氏名", personId: "person-a" }, people).managementName, "人物マスタ名");
  });

  it("prefers cast and staff credit fields while keeping people as the internal name", () => {
    const cast = resolveCastMemberPerson({ id: "cast-a", order: 1, name: "旧氏名", displayName: "舞台掲載名", personId: "person-a" }, people);
    const staff = resolveStaffMemberPerson({ id: "staff-a", name: "旧氏名", creditName: "スタッフ掲載名", personId: "person-a" }, people);
    strictEqual(cast.managementName, "人物マスタ名");
    strictEqual(cast.creditName, "舞台掲載名");
    strictEqual(staff.managementName, "人物マスタ名");
    strictEqual(staff.creditName, "スタッフ掲載名");
  });

  it("falls back to the people management name when credit fields are empty", () => {
    strictEqual(
      resolveCastMemberPerson({ id: "cast-a", order: 1, name: "旧氏名", displayName: " ", personId: "person-a" }, people).creditName,
      "人物マスタ名"
    );
    strictEqual(
      resolveStaffMemberPerson({ id: "staff-a", name: "旧氏名", creditName: " ", personId: "person-a" }, people).creditName,
      "人物マスタ名"
    );
  });

  it("keeps legacy cast and staff names when personId is absent", () => {
    const cast = resolveCastMemberPerson({ id: "cast-legacy", order: 1, name: "従来キャスト名" }, people);
    const staff = resolveStaffMemberPerson({ id: "staff-legacy", name: "従来スタッフ名" }, people);
    strictEqual(cast.person, null);
    strictEqual(cast.managementName, "従来キャスト名");
    strictEqual(cast.creditName, "従来キャスト名");
    strictEqual(staff.person, null);
    strictEqual(staff.managementName, "従来スタッフ名");
    strictEqual(staff.creditName, "従来スタッフ名");
  });

  it("keeps cast and staff credit names independent for the same person", () => {
    const cast = resolveCastMemberPerson({ id: "cast-a", order: 1, name: "旧氏名", displayName: "キャスト芸名", personId: "person-a" }, people);
    const staff = resolveStaffMemberPerson({ id: "staff-a", name: "旧氏名", creditName: "スタッフ表記", personId: "person-a" }, people);
    strictEqual(cast.managementName, "人物マスタ名");
    strictEqual(staff.managementName, "人物マスタ名");
    strictEqual(cast.creditName, "キャスト芸名");
    strictEqual(staff.creditName, "スタッフ表記");
  });

  it("supports the same person in cast and multiple staff roles", () => {
    deepStrictEqual(getCastPersonIds([
      { id: "cast-a", order: 1, name: "A", personId: "person-a" },
    ]), ["person-a"]);
    deepStrictEqual(getStaffPersonIds([
      { id: "role-a", role: "演出", members: [{ id: "staff-a", name: "A", personId: "person-a" }] },
      { id: "role-b", role: "制作", members: [{ id: "staff-b", name: "A", personId: "person-a" }] },
    ]), ["person-a"]);
  });

  it("builds a new active person with explicit attendance and special-practice defaults", () => {
    deepStrictEqual(buildNewPerformancePerson("person-new", " 新規 人物 "), {
      id: "person-new",
      values: {
        displayName: "新規 人物",
        attendanceTarget: false,
        specialPractice: "none",
        rehearsalParticipationTypes: [],
        linkedUserUid: null,
        publicNote: "",
        active: true,
      },
    });
    throws(() => buildNewPerformancePerson("person-new", " "), /氏名/);
  });

  it("automatically prepares only newly added unlinked cast with the management name", () => {
    let sequence = 0;
    const prepared = preparePerformancePeopleForSave(
      "cast",
      [
        { id: "cast-existing", order: 1, name: "旧データ" },
        { id: "cast-new-a", order: 2, name: "田中裕介", displayName: "たなかゆうすけ" },
        { id: "cast-new-b", order: 3, name: "田中裕介" },
      ],
      [{ id: "cast-existing", order: 1, name: "旧データ" }],
      [],
      () => `person-${++sequence}`
    );

    deepStrictEqual(prepared.createdPersonIds, ["person-1", "person-2"]);
    strictEqual(prepared.value[0].personId, undefined);
    strictEqual(prepared.value[1].personId, "person-1");
    strictEqual(prepared.value[2].personId, "person-2");
    deepStrictEqual(prepared.peopleDrafts.map(({ values }) => values), [
      { displayName: "田中裕介", attendanceTarget: false, specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: null, publicNote: "", active: true },
      { displayName: "田中裕介", attendanceTarget: false, specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: null, publicNote: "", active: true },
    ]);
  });

  it("prepares new staff but reuses an explicitly selected existing person", () => {
    const prepared = preparePerformancePeopleForSave(
      "staff",
      [{ id: "role-a", role: "演出", members: [
        { id: "staff-new", name: "スタッフ本名", creditName: "クレジット名" },
        { id: "staff-linked", name: "既存関係者", personId: "person-existing" },
      ] }],
      [],
      [buildNewPerformancePerson("person-existing", "既存関係者", {
        rehearsalParticipationTypes: ["stage_combat"],
      })],
      () => "person-staff"
    );

    strictEqual(prepared.value[0].members[0].personId, "person-staff");
    strictEqual(prepared.peopleDrafts[1].values.displayName, "スタッフ本名");
    deepStrictEqual(prepared.peopleDrafts[1].values.rehearsalParticipationTypes, []);
    strictEqual(prepared.value[0].members[1].personId, "person-existing");
    deepStrictEqual(prepared.peopleDrafts[0].values.rehearsalParticipationTypes, ["stage_combat"]);
    strictEqual(prepared.createdPersonIds.length, 1);
  });

  it("keeps an existing person's rehearsal participation when adding them as cast", () => {
    const prepared = preparePerformancePeopleForSave(
      "cast",
      [{ id: "cast-linked", order: 1, name: "既存関係者", personId: "person-existing" }],
      [],
      [buildNewPerformancePerson("person-existing", "既存関係者", {
        rehearsalParticipationTypes: ["japanese_dance"],
      })],
      () => "unused-person"
    );

    deepStrictEqual(prepared.createdPersonIds, []);
    deepStrictEqual(prepared.peopleDrafts[0].values.rehearsalParticipationTypes, ["japanese_dance"]);
  });
});
