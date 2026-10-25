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
    strictEqual(resolveCastMemberPerson({ id: "cast-a", order: 1, name: "旧氏名", personId: "person-a" }, people).internalName, "人物マスタ名");
  });

  it("prefers cast and staff credit fields while keeping people as the internal name", () => {
    const cast = resolveCastMemberPerson({ id: "cast-a", order: 1, name: "旧氏名", displayName: "舞台掲載名", personId: "person-a" }, people);
    const staff = resolveStaffMemberPerson({ id: "staff-a", name: "旧氏名", creditName: "スタッフ掲載名", personId: "person-a" }, people);
    strictEqual(cast.internalName, "人物マスタ名");
    strictEqual(cast.creditName, "舞台掲載名");
    strictEqual(staff.internalName, "人物マスタ名");
    strictEqual(staff.creditName, "スタッフ掲載名");
  });

  it("keeps legacy staff names when personId is absent", () => {
    const resolved = resolveStaffMemberPerson({ id: "staff-legacy", name: "従来スタッフ名" }, people);
    strictEqual(resolved.person, null);
    strictEqual(resolved.creditName, "従来スタッフ名");
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
