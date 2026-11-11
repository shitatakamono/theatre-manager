import { deepStrictEqual, notStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeReminderRehearsals,
  buildLineRehearsalReminderMessage,
  buildLineReminderDeliveryId,
  buildReminderAttendanceSummary,
  classifyLineReminderFailure,
  getNextTokyoDate,
  getTokyoDateRange,
  isLineReminderScheduleTime,
  uniqueReminderRecipients,
} from "../lib/line-rehearsal-reminder.ts";

const start = new Date("2026-11-15T13:00:00+09:00").getTime();
const end = new Date("2026-11-15T17:00:00+09:00").getTime();
const rehearsal = { id: "r1", startAtMillis: start, endAtMillis: end, typeLabel: "芝居", venue: "会議室A", cancelled: false };
const people = [
  { id: "p1", displayName: "田中", linkedUserUid: "u1", active: true, attendanceTarget: true },
  { id: "p2", displayName: "鈴木", linkedUserUid: "u2", active: true, attendanceTarget: true },
  { id: "p3", displayName: "高橋", linkedUserUid: "u2", active: true, attendanceTarget: true },
];

describe("LINE rehearsal reminder date and schedule", () => {
  it("calculates tomorrow and its range in Asia/Tokyo across a UTC boundary", () => {
    strictEqual(getNextTokyoDate(new Date("2026-11-14T15:30:00Z")), "2026-11-16");
    const range = getTokyoDateRange("2026-11-15");
    strictEqual(new Date(range.startMillis).toISOString(), "2026-11-14T15:00:00.000Z");
    strictEqual(range.endMillis - range.startMillis, 86_400_000);
  });

  it("recognizes noon JST and rejects another minute", () => {
    strictEqual(isLineReminderScheduleTime(new Date("2026-11-15T03:00:00Z")), true);
    strictEqual(isLineReminderScheduleTime(new Date("2026-11-15T03:01:00Z")), false);
  });
});

describe("LINE rehearsal reminder content", () => {
  it("filters cancelled rehearsals and combines multiple rehearsals in one message", () => {
    const dance = { ...rehearsal, id: "r2", typeLabel: "日舞", venue: "和室", startAtMillis: start + 3_600_000 };
    const cancelled = { ...rehearsal, id: "r3", cancelled: true };
    strictEqual(activeReminderRehearsals([cancelled]).length, 0);
    const message = buildLineRehearsalReminderMessage({
      date: "2026-11-15", rehearsals: [dance, rehearsal, cancelled],
      attendance: { attending: ["田中"], late: [], early: [], lateAndEarly: [] },
    });
    strictEqual(message.includes("■ 芝居"), true);
    strictEqual(message.includes("■ 日舞"), true);
    strictEqual(message.includes("会議室A"), true);
    strictEqual(message.includes("r1"), false);
    throws(() => buildLineRehearsalReminderMessage({ date: "2026-11-15", rehearsals: [cancelled], attendance: { attending: [], late: [], early: [], lateAndEarly: [] } }));
  });

  it("summarizes full attendance, lateness and early departure without absent or tentative names", () => {
    const summary = buildReminderAttendanceSummary({
      people,
      rehearsals: [rehearsal],
      attendance: [
        { participantId: "p1", status: "attending", availableFrom: "14:00", availableUntil: "16:00" },
        { participantId: "p2", status: "attending", availableFrom: "14:00", availableUntil: "17:00" },
        { participantId: "p3", status: "attending", availableFrom: "13:00", availableUntil: "16:00" },
        { participantId: "absent", status: "absent", availableFrom: null, availableUntil: null },
        { participantId: "tentative", status: "tentative", availableFrom: null, availableUntil: null },
      ],
    });
    deepStrictEqual(summary.attending, []);
    deepStrictEqual(summary.late, ["鈴木（14:00頃から）"]);
    deepStrictEqual(summary.early, ["高橋（16:00頃まで）"]);
    deepStrictEqual(summary.lateAndEarly, ["田中（14:00頃から／16:00頃まで）"]);
  });

  it("deduplicates recipients by UID regardless of attendance answer", () => {
    deepStrictEqual(uniqueReminderRecipients(people), ["u1", "u2"]);
  });
});

describe("LINE rehearsal reminder delivery", () => {
  it("uses a stable per-project/date/recipient delivery ID", () => {
    const id = buildLineReminderDeliveryId("project", "2026-11-15", "uid");
    strictEqual(id, buildLineReminderDeliveryId("project", "2026-11-15", "uid"));
    notStrictEqual(id, buildLineReminderDeliveryId("project", "2026-11-16", "uid"));
    strictEqual(id.includes("uid"), false);
  });

  it("retries only transient failures and stops at the attempt limit", () => {
    strictEqual(classifyLineReminderFailure("line_network_error", 1), "failed_retryable");
    strictEqual(classifyLineReminderFailure("line_rate_limited", 2), "failed_retryable");
    strictEqual(classifyLineReminderFailure("line_server_error", 3), "failed_permanent");
    strictEqual(classifyLineReminderFailure("line_request_rejected", 1), "failed_permanent");
  });
});
