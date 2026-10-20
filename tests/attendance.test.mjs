import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ATTENDANCE_STATUSES,
  buildAttendanceRecordId,
  buildAttendanceValues,
} from "../lib/attendance.ts";

const attendingInput = {
  participantId: " participant-a ",
  date: " 2026-11-03 ",
  status: "attending",
  availableFrom: " 13:00 ",
  availableUntil: " 16:30 ",
  publicNote: " 途中から参加します ",
};

describe("attendance values", () => {
  it("builds a deterministic record ID", () => {
    strictEqual(buildAttendanceRecordId(" 2026-11-03 ", " participant-a "), "2026-11-03_participant-a");
  });

  it("normalizes a valid attending record", () => {
    deepStrictEqual(buildAttendanceValues(attendingInput), {
      participantId: "participant-a",
      date: "2026-11-03",
      status: "attending",
      availableFrom: "13:00",
      availableUntil: "16:30",
      publicNote: "途中から参加します",
    });
  });

  it("requires both times when attending", () => {
    throws(() => buildAttendanceValues({ ...attendingInput, availableUntil: null }), /参加可能時間/);
    throws(() => buildAttendanceValues({ ...attendingInput, availableFrom: "" }), /参加可能時間/);
  });

  it("rejects an attending range whose start is not before its end", () => {
    throws(() => buildAttendanceValues({ ...attendingInput, availableFrom: "16:30", availableUntil: "16:30" }), /終了時刻/);
    throws(() => buildAttendanceValues({ ...attendingInput, availableFrom: "17:00", availableUntil: "16:30" }), /終了時刻/);
  });

  it("rejects times for absent", () => {
    throws(() => buildAttendanceValues({ ...attendingInput, status: "absent" }), /時間を指定できません/);
    strictEqual(buildAttendanceValues({ ...attendingInput, status: "absent", availableFrom: null, availableUntil: null }).status, "absent");
  });

  it("rejects times for tentative", () => {
    throws(() => buildAttendanceValues({ ...attendingInput, status: "tentative" }), /時間を指定できません/);
    strictEqual(buildAttendanceValues({ ...attendingInput, status: "tentative", availableFrom: null, availableUntil: null }).status, "tentative");
  });

  it("accepts only the three attendance statuses", () => {
    deepStrictEqual(ATTENDANCE_STATUSES, ["attending", "absent", "tentative"]);
    throws(() => buildAttendanceValues({ ...attendingInput, status: "unanswered" }), /出欠状況/);
  });

  it("rejects malformed or impossible dates", () => {
    throws(() => buildAttendanceValues({ ...attendingInput, date: "2026/11/03" }), /YYYY-MM-DD/);
    throws(() => buildAttendanceValues({ ...attendingInput, date: "2026-02-30" }), /YYYY-MM-DD/);
  });

  it("rejects malformed times", () => {
    throws(() => buildAttendanceValues({ ...attendingInput, availableFrom: "9:00" }), /HH:mm/);
    throws(() => buildAttendanceValues({ ...attendingInput, availableUntil: "24:00" }), /HH:mm/);
  });

  it("enforces the public note limit", () => {
    strictEqual(buildAttendanceValues({ ...attendingInput, publicNote: "a".repeat(2000) }).publicNote.length, 2000);
    throws(() => buildAttendanceValues({ ...attendingInput, publicNote: "a".repeat(2001) }), /2000/);
  });
});
