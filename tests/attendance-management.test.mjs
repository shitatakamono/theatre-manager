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
  { id: "b", displayName: "田中", specialPractice: "none", linkedUserUid: null, publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "a", displayName: "佐藤", specialPractice: "stage_combat", linkedUserUid: null, publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "inactive", displayName: "終了", specialPractice: "none", linkedUserUid: null, publicNote: "", active: false, createdByUid: "owner", updatedByUid: "owner" },
];
const records = [
  { id: "2026-11-15_a", participantId: "a", date: "2026-11-15", status: "attending", availableFrom: "13:00", availableUntil: "17:00", publicNote: "", createdByUid: "owner", updatedByUid: "owner" },
  { id: "2026-11-22_a", participantId: "a", date: "2026-11-22", status: "absent", availableFrom: null, availableUntil: null, publicNote: "欠席", createdByUid: "owner", updatedByUid: "owner" },
  { id: "2026-11-15_b", participantId: "b", date: "2026-11-15", status: "tentative", availableFrom: null, availableUntil: null, publicNote: "確認中", createdByUid: "owner", updatedByUid: "owner" },
];
const days = [{ date: "2026-11-22" }, { date: "2026-11-15" }];

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
