import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagedPersonValues,
  EMPTY_MANAGED_PERSON_INPUT,
  filterManagedPeople,
  getManagedPersonChangedFields,
  getPersonAssociations,
  sortManagedPeople,
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
      rehearsalParticipationTypes: ["acting"],
      linkedUserUid: null,
      publicNote: "備考",
      active: true,
    });
    strictEqual(buildManagedPersonValues({ ...input, attendanceTarget: true }).attendanceTarget, true);
    throws(() => buildManagedPersonValues({ ...input, displayName: " " }), /氏名/);
  });

  it("keeps a directly added other person without rehearsal participation by default", () => {
    deepStrictEqual(buildManagedPersonValues({
      ...EMPTY_MANAGED_PERSON_INPUT,
      displayName: "その他の関係者",
    }).rehearsalParticipationTypes, []);
  });

  it("reports only editable people fields", () => {
    const before = buildManagedPersonValues(input);
    const after = buildManagedPersonValues({
      ...input,
      attendanceTarget: true,
      linkedUserUid: "member-a",
    });
    deepStrictEqual(getManagedPersonChangedFields(before, after), ["出欠管理対象", "システム利用者連携"]);
    const rehearsalsChanged = buildManagedPersonValues({
      ...input,
      rehearsalParticipationTypes: ["acting", "stage_combat"],
    });
    deepStrictEqual(getManagedPersonChangedFields(before, rehearsalsChanged), ["参加する稽古"]);
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

  it("sorts by cast, staff, and other roles with Japanese names inside each group", () => {
    const managedPeople = [
      { id: "other-a", displayName: "あおい", active: true },
      { id: "staff-ka", displayName: "かとう", active: true },
      { id: "cast-sa", displayName: "さとう", active: true },
      { id: "both-i", displayName: "いとう", active: true },
      { id: "cast-a", displayName: "あべ", active: false },
      { id: "staff-a", displayName: "あらい", active: true },
    ];
    const cast = [
      { id: "cast-1", order: 1, name: "さとう", personId: "cast-sa" },
      { id: "cast-2", order: 2, name: "いとう", personId: "both-i" },
      { id: "cast-3", order: 3, name: "あべ", personId: "cast-a" },
    ];
    const staff = [{ id: "role-1", role: "演出", members: [
      { id: "staff-1", name: "かとう", personId: "staff-ka" },
      { id: "staff-2", name: "いとう", personId: "both-i" },
      { id: "staff-3", name: "あらい", personId: "staff-a" },
    ] }];

    deepStrictEqual(
      sortManagedPeople(filterManagedPeople(managedPeople, true), cast, staff, "cast_first").map(({ id }) => id),
      ["cast-a", "both-i", "cast-sa", "staff-a", "staff-ka", "other-a"]
    );
    deepStrictEqual(
      sortManagedPeople(filterManagedPeople(managedPeople, true), cast, staff, "staff_first").map(({ id }) => id),
      ["staff-a", "both-i", "staff-ka", "cast-a", "cast-sa", "other-a"]
    );
    deepStrictEqual(
      sortManagedPeople(filterManagedPeople(managedPeople, true), cast, staff, "name").map(({ id }) => id),
      ["other-a", "cast-a", "staff-a", "both-i", "staff-ka", "cast-sa"]
    );
    deepStrictEqual(
      sortManagedPeople(filterManagedPeople(managedPeople, false), cast, staff, "cast_first").map(({ id }) => id),
      ["both-i", "cast-sa", "staff-a", "staff-ka", "other-a"]
    );
  });

  it("reuses cast order and the first staff appearance for published ordering", () => {
    const managedPeople = [
      { id: "other", displayName: "その他", active: true },
      { id: "cast-2", displayName: "キャスト二", active: true },
      { id: "staff-1", displayName: "スタッフ一", active: true },
      { id: "both", displayName: "兼任", active: true },
      { id: "multi", displayName: "複数役職", active: true },
      { id: "cast-1", displayName: "キャスト一", active: true },
      { id: "staff-2", displayName: "スタッフ二", active: true },
    ];
    const cast = [
      { id: "cast-b", order: 20, name: "キャスト二", personId: "cast-2" },
      { id: "cast-both", order: 10, name: "兼任", personId: "both" },
      { id: "cast-a", order: 5, name: "キャスト一", personId: "cast-1" },
    ];
    const staff = [
      { id: "role-1", role: "演出", members: [
        { id: "staff-b", name: "スタッフ二", personId: "staff-2" },
        { id: "staff-both", name: "兼任", personId: "both" },
        { id: "staff-multi-1", name: "複数役職", personId: "multi" },
      ] },
      { id: "role-2", role: "舞台監督", members: [
        { id: "staff-a", name: "スタッフ一", personId: "staff-1" },
        { id: "staff-multi-2", name: "複数役職", personId: "multi" },
      ] },
    ];

    deepStrictEqual(sortManagedPeople(managedPeople, cast, staff, "cast_order").map(({ id }) => id), [
      "cast-1", "both", "cast-2", "staff-2", "multi", "staff-1", "other",
    ]);
    deepStrictEqual(sortManagedPeople(managedPeople, cast, staff, "staff_order").map(({ id }) => id), [
      "staff-2", "both", "multi", "staff-1", "cast-1", "cast-2", "other",
    ]);
  });
});
