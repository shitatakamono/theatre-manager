import { deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDashboardAttendanceSummary } from "../lib/project-dashboard.ts";

const participants = [
  { id: "a", displayName: "田中", specialPractice: "none", linkedUserUid: "viewer-a", publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "b", displayName: "佐藤", specialPractice: "none", linkedUserUid: "viewer-b", publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "inactive", displayName: "終了", specialPractice: "none", linkedUserUid: "viewer-old", publicNote: "", active: false, createdByUid: "owner", updatedByUid: "owner" },
];
const dates = ["2026-11-15", "2026-11-22"];
const records = [
  { id: "2026-11-15_a", participantId: "a", date: "2026-11-15", status: "attending", availableFrom: "13:00", availableUntil: "17:00", publicNote: "", createdByUid: "viewer-a", updatedByUid: "viewer-a" },
];

describe("project dashboard attendance summary", () => {
  it("shows the whole active-participant unanswered count to owners", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "owner", "owner", participants, dates, records), {
      label: "未回答出欠", value: "3件", detail: "2日分の今後の稽古", href: "/projects/p/attendance/manage",
    });
  });

  it("shows the whole active-participant unanswered count to editors", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "editor", "editor", participants, dates, records), {
      label: "未回答出欠", value: "3件", detail: "2日分の今後の稽古", href: "/projects/p/attendance/manage",
    });
  });

  it("shows only the linked active participant count to a viewer", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "viewer", "viewer-a", participants, dates, records), {
      label: "あなたの未回答", value: "1件", detail: "2日分の今後の稽古", href: "/projects/p/attendance",
    });
  });

  it("shows an unlinked state instead of zero for a viewer without an active participant", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "viewer", "missing", participants, dates, records), {
      label: "あなたの未回答", value: "未連携", detail: "参加者情報との紐付けが必要です", href: "/projects/p/attendance",
    });
  });
});
