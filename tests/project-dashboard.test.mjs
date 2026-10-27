import { deepStrictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDashboardAttendanceSummary } from "../lib/project-dashboard.ts";

const participants = [
  { id: "a", displayName: "田中", attendanceTarget: true, specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: "viewer-a", publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "b", displayName: "佐藤", attendanceTarget: true, specialPractice: "none", rehearsalParticipationTypes: [], linkedUserUid: "viewer-b", publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "disabled", displayName: "対象外", attendanceTarget: false, specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: "viewer-disabled", publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "inactive", displayName: "終了", attendanceTarget: true, specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: "viewer-old", publicNote: "", active: false, createdByUid: "owner", updatedByUid: "owner" },
];
const days = [
  { date: "2026-11-15", rehearsals: [{ type: "acting" }], fullTimeRange: null },
  { date: "2026-11-22", rehearsals: [{ type: "acting" }], fullTimeRange: null },
];
const cast = [{ id: "cast-a", order: 1, name: "田中", personId: "a" }];
const staff = [{ id: "role-a", role: "演出", members: [{ id: "staff-b", name: "佐藤", personId: "b" }] }];
const records = [
  { id: "2026-11-15_a", participantId: "a", date: "2026-11-15", status: "attending", availableFrom: "13:00", availableUntil: "17:00", publicNote: "", createdByUid: "viewer-a", updatedByUid: "viewer-a" },
];

describe("project dashboard attendance summary", () => {
  it("shows the whole active-participant unanswered count to owners", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "owner", "owner", participants, days, records, cast, staff), {
      label: "未回答出欠", value: "1件", detail: "2日分の今後の稽古", href: "/projects/p/attendance/manage",
    });
  });

  it("shows the whole active-participant unanswered count to editors", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "editor", "editor", participants, days, records, cast, staff), {
      label: "未回答出欠", value: "1件", detail: "2日分の今後の稽古", href: "/projects/p/attendance/manage",
    });
  });

  it("shows only the linked active participant count to a viewer", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "viewer", "viewer-a", participants, days, records, cast, staff), {
      label: "あなたの未回答", value: "1件", detail: "2日分の今後の稽古", href: "/projects/p/attendance",
    });
  });

  it("shows an unlinked state instead of zero for a viewer without an active participant", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "viewer", "missing", participants, days, records, cast, staff), {
      label: "あなたの未回答", value: "未連携", detail: "参加者情報との紐付けが必要です", href: "/projects/p/attendance",
    });
  });

  it("does not count staff-only optional days as unanswered", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "viewer", "viewer-b", participants, days, records, cast, staff), {
      label: "あなたの未回答", value: "0件", detail: "2日分の今後の稽古", href: "/projects/p/attendance",
    });
  });

  it("does not count attendanceTarget-off people as unanswered", () => {
    deepStrictEqual(buildDashboardAttendanceSummary("p", "viewer", "viewer-disabled", participants, days, records, cast, staff), {
      label: "あなたの未回答", value: "対象外", detail: "現在は出欠入力の対象外です", href: "/projects/p/attendance",
    });
    deepStrictEqual(buildDashboardAttendanceSummary("p", "owner", "owner", participants, days, records, cast, staff), {
      label: "未回答出欠", value: "1件", detail: "2日分の今後の稽古", href: "/projects/p/attendance/manage",
    });
  });
});
