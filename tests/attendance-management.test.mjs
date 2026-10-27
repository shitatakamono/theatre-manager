import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAttendanceManagementMatrix,
  buildChangedManagementInput,
  buildManagementDraft,
  formatAttendanceCell,
  getManagementDraftError,
} from "../lib/attendance-management.ts";

const participants = [
  { id: "b", displayName: "田中", attendanceTarget: true, specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: null, publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "a", displayName: "佐藤", attendanceTarget: true, specialPractice: "stage_combat", rehearsalParticipationTypes: ["acting", "stage_combat"], linkedUserUid: null, publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "inactive", displayName: "終了", attendanceTarget: true, specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: null, publicNote: "", active: false, createdByUid: "owner", updatedByUid: "owner" },
];
const records = [
  { id: "2026-11-15_a", participantId: "a", date: "2026-11-15", status: "attending", availableFrom: "13:00", availableUntil: "17:00", publicNote: "", createdByUid: "owner", updatedByUid: "owner" },
  { id: "2026-11-22_a", participantId: "a", date: "2026-11-22", status: "absent", availableFrom: null, availableUntil: null, publicNote: "欠席", createdByUid: "owner", updatedByUid: "owner" },
  { id: "2026-11-15_b", participantId: "b", date: "2026-11-15", status: "tentative", availableFrom: null, availableUntil: null, publicNote: "確認中", createdByUid: "owner", updatedByUid: "owner" },
];
const days = [
  { date: "2026-11-22", rehearsals: [{ type: "acting" }], fullTimeRange: null },
  { date: "2026-11-15", rehearsals: [{ type: "acting" }], fullTimeRange: null },
];

describe("attendance management matrix", () => {
  it("sorts days and active participants and represents every status including unanswered", () => {
    const rows = buildAttendanceManagementMatrix(participants, days, records);
    deepStrictEqual(rows.map(({ participant }) => participant.displayName), ["佐藤", "田中"]);
    deepStrictEqual(rows[0].cells.map(({ date }) => date), ["2026-11-15", "2026-11-22"]);
    deepStrictEqual(rows.map((row) => row.cells.map(({ record }) => record?.status ?? "unanswered")), [
      ["attending", "absent"],
      ["tentative", "unanswered"],
    ]);
    strictEqual(rows.some(({ participant }) => participant.id === "inactive"), false);
  });

  it("filters participants with unanswered or tentative dates", () => {
    deepStrictEqual(buildAttendanceManagementMatrix(participants, days, records, "unanswered").map((row) => row.participant.id), ["b"]);
    deepStrictEqual(buildAttendanceManagementMatrix(participants, days, records, "tentative").map((row) => row.participant.id), ["b"]);
  });

  it("formats attending, absent, tentative, and unanswered cells", () => {
    strictEqual(formatAttendanceCell(records[0]), "○ 13:00〜17:00");
    strictEqual(formatAttendanceCell(records[1]), "× 不参加");
    strictEqual(formatAttendanceCell(records[2]), "△ 未定");
    strictEqual(formatAttendanceCell(null), "未回答");
    strictEqual(formatAttendanceCell(null, "optional"), "参加予定なし");
    strictEqual(formatAttendanceCell(null, "not_applicable"), "対象外");
  });

  it("does not treat optional staff or non-target rehearsals as unanswered", () => {
    const staffOnly = { ...participants[1], id: "staff", displayName: "スタッフ", rehearsalParticipationTypes: [] };
    const disabled = { ...participants[1], id: "disabled", displayName: "対象外", attendanceTarget: false };
    const cast = [{ id: "cast-a", order: 1, name: "田中", personId: "b" }];
    const staff = [{ id: "role", role: "演出", members: [{ id: "staff-a", name: "スタッフ", personId: "staff" }] }];
    const danceDay = [{ date: "2026-11-30", rehearsals: [{ type: "japanese_dance" }], fullTimeRange: null }];
    const rows = buildAttendanceManagementMatrix([participants[0], staffOnly, disabled], danceDay, [], "all", cast, staff);
    strictEqual(rows.find(({ participant }) => participant.id === "b")?.cells[0].requirement, "not_applicable");
    strictEqual(rows.find(({ participant }) => participant.id === "staff")?.cells[0].requirement, "optional");
    strictEqual(rows.find(({ participant }) => participant.id === "disabled")?.cells[0].requirement, "not_applicable");
    deepStrictEqual(buildAttendanceManagementMatrix([participants[0], staffOnly, disabled], danceDay, [], "unanswered", cast, staff), []);
  });

  it("uses the shared people ordering for the rows consumed by PC and mobile views", () => {
    const people = [
      { ...participants[0], id: "other", displayName: "その他" },
      { ...participants[0], id: "cast-later", displayName: "後のキャスト" },
      { ...participants[0], id: "staff-first", displayName: "最初のスタッフ" },
      { ...participants[0], id: "both", displayName: "兼任" },
      { ...participants[0], id: "cast-first", displayName: "最初のキャスト" },
    ];
    const cast = [
      { id: "cast-later", order: 20, name: "後", personId: "cast-later" },
      { id: "cast-both", order: 10, name: "兼任", personId: "both" },
      { id: "cast-first", order: 1, name: "先", personId: "cast-first" },
    ];
    const staff = [{ id: "role", role: "演出", members: [
      { id: "staff-first", name: "先", personId: "staff-first" },
      { id: "staff-both", name: "兼任", personId: "both" },
    ] }];

    deepStrictEqual(
      buildAttendanceManagementMatrix(people, days, [], "all", cast, staff, "cast_order")
        .map(({ participant }) => participant.id),
      ["cast-first", "both", "cast-later", "staff-first", "other"]
    );
    deepStrictEqual(
      buildAttendanceManagementMatrix(people, days, [], "all", cast, staff, "staff_order")
        .map(({ participant }) => participant.id),
      ["staff-first", "both", "cast-first", "cast-later", "other"]
    );
  });
});

describe("attendance management edit helpers", () => {
  it("creates an input when editing an unanswered cell", () => {
    const input = buildChangedManagementInput("b", "2026-11-22", { status: "absent", availableFrom: null, availableUntil: null, publicNote: "欠席" }, null);
    strictEqual(input?.status, "absent");
  });

  it("loads an existing record and returns no input when unchanged", () => {
    const draft = buildManagementDraft(records[0]);
    deepStrictEqual(draft, { status: "attending", availableFrom: "13:00", availableUntil: "17:00", publicNote: "" });
    strictEqual(buildChangedManagementInput("a", "2026-11-15", draft, records[0]), null);
  });

  it("returns a normalized update when an existing record changes", () => {
    const input = buildChangedManagementInput("a", "2026-11-15", { status: "tentative", availableFrom: "13:00", availableUntil: "17:00", publicNote: " 確認中 " }, records[0]);
    deepStrictEqual(input, { participantId: "a", date: "2026-11-15", status: "tentative", availableFrom: null, availableUntil: null, publicNote: "確認中" });
  });

  it("requires a valid time range only when attending", () => {
    strictEqual(getManagementDraftError({ status: null, availableFrom: null, availableUntil: null, publicNote: "" }), "参加・不参加・未定を選択してください");
    strictEqual(getManagementDraftError({ status: "attending", availableFrom: null, availableUntil: null, publicNote: "" }), "参加可能時間を入力してください");
    strictEqual(getManagementDraftError({ status: "attending", availableFrom: "17:00", availableUntil: "17:00", publicNote: "" }), "終了時刻は開始時刻より後にしてください");
    strictEqual(getManagementDraftError({ status: "attending", availableFrom: "18:00", availableUntil: "17:00", publicNote: "" }), "終了時刻は開始時刻より後にしてください");
    strictEqual(getManagementDraftError({ status: "attending", availableFrom: "13:00", availableUntil: "17:00", publicNote: "" }), null);
    strictEqual(getManagementDraftError({ status: "absent", availableFrom: null, availableUntil: null, publicNote: "" }), null);
    strictEqual(getManagementDraftError({ status: "tentative", availableFrom: null, availableUntil: null, publicNote: "" }), null);
  });
});
