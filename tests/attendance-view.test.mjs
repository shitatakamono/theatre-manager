import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { Timestamp } from "firebase/firestore";
import {
  buildAttendanceDrafts,
  buildFutureRehearsalDays,
  buildSharedAttendanceRows,
  findSelfParticipant,
  getChangedAttendanceInputs,
} from "../lib/attendance-view.ts";

function rehearsal(id, start, end, type = "acting") {
  return {
    id,
    startAt: Timestamp.fromDate(new Date(start)),
    endAt: end ? Timestamp.fromDate(new Date(end)) : null,
    type,
    customType: "",
    venue: "稽古場",
    content: "",
    note: "",
    revision: 0,
    createdByUid: "owner",
    updatedByUid: "owner",
  };
}

const participants = [
  { id: "participant-a", displayName: "田中", specialPractice: "none", linkedUserUid: "user-a", publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "participant-b", displayName: "佐藤", specialPractice: "stage_combat", linkedUserUid: null, publicNote: "", active: true, createdByUid: "owner", updatedByUid: "owner" },
  { id: "participant-c", displayName: "終了", specialPractice: "none", linkedUserUid: null, publicNote: "", active: false, createdByUid: "owner", updatedByUid: "owner" },
];

describe("attendance day helpers", () => {
  it("groups multiple rehearsals on the same Tokyo date into one day and sorts dates", () => {
    const days = buildFutureRehearsalDays([
      rehearsal("later", "2026-11-16T04:00:00Z", "2026-11-16T08:00:00Z"),
      rehearsal("dance", "2026-11-15T05:00:00Z", "2026-11-15T07:00:00Z", "japanese_dance"),
      rehearsal("acting", "2026-11-15T04:00:00Z", "2026-11-15T09:00:00Z"),
    ], new Date("2026-11-14T15:00:00Z"));
    deepStrictEqual(days.map(({ date }) => date), ["2026-11-15", "2026-11-16"]);
    deepStrictEqual(days[0].rehearsals.map(({ id }) => id), ["acting", "dance"]);
  });

  it("excludes dates before today using Asia/Tokyo rather than UTC", () => {
    const days = buildFutureRehearsalDays([
      rehearsal("past", "2026-11-14T14:00:00Z", "2026-11-14T16:00:00Z"),
      rehearsal("tokyo-today", "2026-11-14T16:00:00Z", "2026-11-14T18:00:00Z"),
    ], new Date("2026-11-14T15:30:00Z"));
    deepStrictEqual(days.map(({ date }) => date), ["2026-11-15"]);
  });

  it("uses the earliest start and latest end for full-day attendance", () => {
    const [day] = buildFutureRehearsalDays([
      rehearsal("acting", "2026-11-15T04:00:00Z", "2026-11-15T07:00:00Z"),
      rehearsal("dance", "2026-11-15T05:00:00Z", "2026-11-15T09:30:00Z"),
    ], new Date("2026-11-14T15:00:00Z"));
    deepStrictEqual(day.fullTimeRange, { from: "13:00", until: "18:30" });
  });

  it("does not infer a full-day range when any rehearsal has no end", () => {
    const [day] = buildFutureRehearsalDays([
      rehearsal("known", "2026-11-15T04:00:00Z", "2026-11-15T07:00:00Z"),
      rehearsal("unknown", "2026-11-15T08:00:00Z", null),
    ], new Date("2026-11-14T15:00:00Z"));
    strictEqual(day.fullTimeRange, null);
  });
});

describe("attendance form and sharing helpers", () => {
  const days = [{ date: "2026-11-15" }, { date: "2026-11-16" }];
  const record = {
    id: "2026-11-15_participant-a",
    participantId: "participant-a",
    date: "2026-11-15",
    status: "attending",
    availableFrom: "13:00",
    availableUntil: "17:00",
    publicNote: "途中退出",
    createdByUid: "user-a",
    updatedByUid: "user-a",
  };

  it("loads existing attendance and represents no record as unanswered", () => {
    const drafts = buildAttendanceDrafts(days, "participant-a", [record]);
    deepStrictEqual(drafts["2026-11-15"], { status: "attending", availableFrom: "13:00", availableUntil: "17:00", publicNote: "途中退出" });
    deepStrictEqual(drafts["2026-11-16"], { status: null, availableFrom: null, availableUntil: null, publicNote: "" });
  });

  it("does not create records for untouched unanswered days or unchanged answers", () => {
    const drafts = buildAttendanceDrafts(days, "participant-a", [record]);
    deepStrictEqual(getChangedAttendanceInputs(days, "participant-a", drafts, [record]), []);
  });

  it("builds changed attending, absent, and tentative inputs", () => {
    const attending = { status: "attending", availableFrom: "14:00", availableUntil: "18:00", publicNote: "" };
    const absent = { status: "absent", availableFrom: null, availableUntil: null, publicNote: "欠席" };
    const tentative = { status: "tentative", availableFrom: null, availableUntil: null, publicNote: "確認中" };
    strictEqual(getChangedAttendanceInputs([{ date: "2026-11-16" }], "participant-a", { "2026-11-16": attending }, []).at(0)?.status, "attending");
    strictEqual(getChangedAttendanceInputs([{ date: "2026-11-16" }], "participant-a", { "2026-11-16": absent }, []).at(0)?.status, "absent");
    strictEqual(getChangedAttendanceInputs([{ date: "2026-11-16" }], "participant-a", { "2026-11-16": tentative }, []).at(0)?.status, "tentative");
  });

  it("finds the linked participant and includes unanswered active participants in sharing", () => {
    strictEqual(findSelfParticipant(participants, "user-a")?.id, "participant-a");
    strictEqual(findSelfParticipant(participants, "missing"), null);
    const rows = buildSharedAttendanceRows("2026-11-15", participants, [record]);
    deepStrictEqual(rows.map(({ participant, record: item }) => [participant.displayName, item?.status ?? "unanswered"]), [
      ["佐藤", "unanswered"],
      ["田中", "attending"],
    ]);
  });
});
