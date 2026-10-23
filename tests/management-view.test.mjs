import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PERFORMANCE_INFORMATION_SECTIONS,
  SYSTEM_ROLE_LABELS,
  filterActivityLogs,
  formatInformationValue,
  getActivityCategories,
  getSystemUserStatus,
} from "../lib/management-view.ts";

const timestamp = (value) => ({ toDate: () => new Date(value) });

describe("performance information layout", () => {
  it("keeps the required sections in one stable vertical order", () => {
    deepStrictEqual(PERFORMANCE_INFORMATION_SECTIONS.map(({ label }) => label), [
      "基本情報", "公演日・会場", "料金", "キャスト", "スタッフ",
      "協賛・協力等", "タイムスケジュール", "交通アクセス",
    ]);
    strictEqual(new Set(PERFORMANCE_INFORMATION_SECTIONS.map(({ id }) => id)).size, 8);
    strictEqual(formatInformationValue("既存値"), "既存値");
    strictEqual(formatInformationValue(""), "未入力");
  });
});

describe("system user presentation", () => {
  it("shows all existing roles and does not invent an account state", () => {
    deepStrictEqual(SYSTEM_ROLE_LABELS, { owner: "Owner", editor: "Editor", viewer: "Viewer" });
    strictEqual(getSystemUserStatus(), "有効");
  });
});

describe("activity history presentation", () => {
  const logs = [
    { id: "1", sectionLabel: "基本情報", actorName: "田中", changedFields: ["公演名称"], createdAt: timestamp("2026-10-23T15:10:00Z") },
    { id: "2", sectionLabel: "会場", actorName: "佐藤", changedFields: ["会場名"], createdAt: timestamp("2026-10-24T02:00:00Z") },
  ];

  it("lists categories and filters by category and Tokyo date", () => {
    deepStrictEqual(getActivityCategories(logs), ["会場", "基本情報"]);
    deepStrictEqual(filterActivityLogs(logs, "会場", "").map(({ id }) => id), ["2"]);
    deepStrictEqual(filterActivityLogs(logs, "", "2026-10-24").map(({ id }) => id), ["1", "2"]);
  });
});
