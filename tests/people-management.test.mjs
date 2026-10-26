import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagedPersonValues,
  filterManagedPeople,
  getManagedPersonChangedFields,
  getPersonAssociations,
} from "../lib/people-management.ts";

const input = {
  displayName: " 田中 裕介 ",
  attendanceTarget: false,
  specialPractice: "none",
  linkedUserUid: null,
  publicNote: " 備考 ",
};

describe("people management values", () => {
  it("creates an active person while keeping attendance opt-in", () => {
    deepStrictEqual(buildManagedPersonValues(input), {
      displayName: "田中 裕介",
      attendanceTarget: false,
      specialPractice: "none",
      linkedUserUid: null,
      publicNote: "備考",
      active: true,
    });
    strictEqual(buildManagedPersonValues({ ...input, attendanceTarget: true }).attendanceTarget, true);
    throws(() => buildManagedPersonValues({ ...input, displayName: " " }), /氏名/);
  });

  it("reports only editable people fields", () => {
    const before = buildManagedPersonValues(input);
    const after = buildManagedPersonValues({
      ...input,
      attendanceTarget: true,
      linkedUserUid: "member-a",
    });
    deepStrictEqual(getManagedPersonChangedFields(before, after), ["出欠管理対象", "システム利用者連携"]);
  });

  it("shows active people by default and can include ended people", () => {
    const people = [
      { id: "active", active: true },
      { id: "inactive", active: false },
    ];
    deepStrictEqual(filterManagedPeople(people, false).map(({ id }) => id), ["active"]);
    deepStrictEqual(filterManagedPeople(people, true).map(({ id }) => id), ["active", "inactive"]);
  });

  it("derives cast and staff registration from personId without copying it to people", () => {
    deepStrictEqual(getPersonAssociations(
      "person-a",
      "本名",
      [
        { id: "cast-a", order: 1, name: "管理名", displayName: "芸名", personId: "person-a" },
        { id: "cast-b", order: 2, name: "管理名", displayName: "", personId: "person-a" },
      ],
      [{ id: "role-a", role: "演出", members: [{ id: "staff-a", name: "氏名", personId: "person-a" }] }]
    ), {
      cast: true,
      staff: true,
      castLabels: ["芸名"],
      staffRoles: ["演出"],
    });
    deepStrictEqual(getPersonAssociations(
      "person-a",
      "本名",
      [{ id: "cast-a", order: 1, name: "旧氏名", displayName: "", personId: "person-a" }],
      []
    ).castLabels, ["本名"]);
    deepStrictEqual(getPersonAssociations("person-b", "別の本名", [], []), {
      cast: false,
      staff: false,
      castLabels: [],
      staffRoles: [],
    });
  });
});
