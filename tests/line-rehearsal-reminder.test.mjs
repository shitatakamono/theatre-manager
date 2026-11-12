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
  LINE_TEXT_MESSAGE_MAX_LENGTH,
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
    const combat = { ...rehearsal, id: "r3", typeLabel: "殺陣", venue: "体育室", startAtMillis: start + 7_200_000 };
    const secondActing = { ...rehearsal, id: "r4", venue: "会議室B", startAtMillis: start + 10_800_000 };
    const cancelled = { ...rehearsal, id: "r5", cancelled: true };
    strictEqual(activeReminderRehearsals([cancelled]).length, 0);
    const message = buildLineRehearsalReminderMessage({
      date: "2026-11-15", rehearsals: [secondActing, dance, rehearsal, combat, cancelled],
      attendance: { attending: ["田中"], late: [], early: [], lateAndEarly: [], absent: [], tentative: [], unanswered: [] },
    });
    strictEqual(message.match(/■ 芝居/g)?.length, 2);
    strictEqual(message.includes("■ 日舞"), true);
    strictEqual(message.includes("■ 殺陣"), true);
    strictEqual(message.includes("会議室A"), true);
    strictEqual(message.includes("会議室B"), true);
    strictEqual(message.includes("r1"), false);
    strictEqual(message.includes("出欠は当日全体の予定です（部門別ではありません）"), true);
    strictEqual(message.includes("遅刻："), false);
    strictEqual(message.includes("欠席："), false);
    strictEqual(message.includes("未定："), false);
    strictEqual(message.includes("未回答："), false);
    throws(() => buildLineRehearsalReminderMessage({ date: "2026-11-15", rehearsals: [cancelled], attendance: { attending: [], late: [], early: [], lateAndEarly: [], absent: [], tentative: [], unanswered: [] } }));
  });

  it("separates attending, absent, tentative and unanswered daily attendance", () => {
    const attendancePeople = [
      ...people,
      { id: "p4", displayName: "欠席者", linkedUserUid: "u4", active: true, attendanceTarget: true },
      { id: "p5", displayName: "未定者", linkedUserUid: "u5", active: true, attendanceTarget: true },
      { id: "p6", displayName: "未回答者", linkedUserUid: "u6", active: true, attendanceTarget: true },
    ];
    const summary = buildReminderAttendanceSummary({
      people: attendancePeople,
      rehearsals: [rehearsal],
      attendance: [
        { participantId: "p1", status: "attending", availableFrom: "14:00", availableUntil: "16:00" },
        { participantId: "p2", status: "attending", availableFrom: "14:00", availableUntil: "17:00" },
        { participantId: "p3", status: "attending", availableFrom: "13:00", availableUntil: "16:00" },
        { participantId: "p4", status: "absent", availableFrom: null, availableUntil: null },
        { participantId: "p5", status: "tentative", availableFrom: null, availableUntil: null },
      ],
    });
    deepStrictEqual(summary.attending, []);
    deepStrictEqual(summary.late, ["鈴木（14:00頃から）"]);
    deepStrictEqual(summary.early, ["高橋（16:00頃まで）"]);
    deepStrictEqual(summary.lateAndEarly, ["田中（14:00頃から／16:00頃まで）"]);
    deepStrictEqual(summary.absent, ["欠席者"]);
    deepStrictEqual(summary.tentative, ["未定者"]);
    deepStrictEqual(summary.unanswered, ["未回答者"]);
    const message = buildLineRehearsalReminderMessage({ date: "2026-11-15", rehearsals: [rehearsal], attendance: summary });
    strictEqual(message.includes("欠席：\n・欠席者"), true);
    strictEqual(message.includes("未定：\n・未定者"), true);
    strictEqual(message.includes("未回答：\n・未回答者"), true);
    strictEqual(message.includes("出席予定："), false);
  });

  it("keeps one daily attendance entry when a person is relevant to multiple rehearsal types", () => {
    const summary = buildReminderAttendanceSummary({
      people: [people[0]],
      rehearsals: [
        rehearsal,
        { ...rehearsal, id: "dance", typeLabel: "日舞", startAtMillis: start + 3_600_000 },
        { ...rehearsal, id: "combat", typeLabel: "殺陣", startAtMillis: start + 7_200_000 },
      ],
      attendance: [{ participantId: "p1", status: "attending", availableFrom: "13:00", availableUntil: "17:00" }],
    });
    deepStrictEqual(summary.attending, ["田中"]);
  });

  it("stays within LINE's UTF-16 limit and reports omitted people and rehearsal slots", () => {
    const manyRehearsals = Array.from({ length: 300 }, (_, index) => ({
      ...rehearsal,
      id: `r-${index}`,
      typeLabel: `非常に長い稽古種別${"種".repeat(100)}`,
      venue: `非常に長い会場名${"会".repeat(300)}`,
      startAtMillis: start + index * 60_000,
    }));
    const manyNames = Array.from({ length: 1000 }, (_, index) => `参加者${index}${"名".repeat(20)}`);
    const message = buildLineRehearsalReminderMessage({
      date: "2026-11-15",
      rehearsals: manyRehearsals,
      attendance: {
        attending: manyNames, late: manyNames, early: manyNames, lateAndEarly: manyNames,
        absent: manyNames, tentative: manyNames, unanswered: manyNames,
      },
    });
    strictEqual(message.length <= LINE_TEXT_MESSAGE_MAX_LENGTH, true);
    strictEqual(message.includes("件の稽古枠があります"), true);
    strictEqual(message.includes("ほか"), true);
    strictEqual(message.includes("SeisakuBoardで最新の稽古予定と出欠をご確認ください"), true);
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
