import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNewPerformancePerson,
  getCastPersonIds,
  getStaffPersonIds,
  resolveCastMemberPerson,
  resolveStaffMemberPerson,
} from "../lib/performance-people.ts";

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
        linkedUserUid: null,
        publicNote: "",
        active: true,
      },
    });
    throws(() => buildNewPerformancePerson("person-new", " "), /氏名/);
  });
});
