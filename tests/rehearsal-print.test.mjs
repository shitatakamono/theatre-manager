import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { Timestamp } from "firebase/firestore";
import { buildRehearsalPrintModel } from "../lib/rehearsal-print.ts";

function rehearsal(id, date, startTime, endTime, type, venue = "稽古場") {
  const toTimestamp = (time) => Timestamp.fromDate(new Date(`${date}T${time}:00+09:00`));
  return {
    id,
    startAt: toTimestamp(startTime),
    endAt: endTime ? toTimestamp(endTime) : null,
    type,
    customType: "",
    venue,
    content: "",
    note: "",
    revision: 0,
    createdByUid: "owner",
    updatedByUid: "owner",
  };
}

describe("rehearsal print model", () => {
  it("keeps today and future dates in Tokyo while excluding earlier dates", () => {
    const now = new Date("2026-10-19T15:30:00.000Z"); // 2026-10-20 00:30 in Tokyo
    const model = buildRehearsalPrintModel([
      rehearsal("past", "2026-10-19", "13:00", "14:00", "acting"),
      rehearsal("today", "2026-10-20", "13:00", "14:00", "acting"),
      rehearsal("future", "2026-10-21", "13:00", "14:00", "acting"),
    ], now);

    deepStrictEqual(model.days.map((day) => day.date), ["2026-10-20", "2026-10-21"]);
    deepStrictEqual(model.days.flatMap((day) => day.categories.flatMap((category) => category.bars.map((bar) => bar.id))), ["today", "future"]);
  });

  it("sorts dates and categories in the print order", () => {
    const model = buildRehearsalPrintModel([
      rehearsal("combat", "2026-11-16", "13:00", "14:00", "stage_combat"),
      rehearsal("other", "2026-11-15", "14:00", "15:00", "other"),
      rehearsal("acting", "2026-11-15", "12:00", "13:00", "acting"),
      rehearsal("dance", "2026-11-15", "13:00", "14:00", "japanese_dance"),
      rehearsal("meeting", "2026-11-15", "15:00", "16:00", "meeting"),
      rehearsal("combat-early", "2026-11-15", "16:00", "17:00", "stage_combat"),
    ]);

    deepStrictEqual(model.days.map((day) => day.date), ["2026-11-15", "2026-11-16"]);
    deepStrictEqual(model.days[0].categories.map((category) => category.type), [
      "acting", "japanese_dance", "stage_combat", "meeting", "other",
    ]);
  });

  it("keeps the three basic category rows even when they have no rehearsals", () => {
    const model = buildRehearsalPrintModel([
      rehearsal("acting", "2026-11-15", "12:00", "13:00", "acting"),
    ]);

    deepStrictEqual(model.days[0].categories.map((category) => category.type), [
      "acting", "japanese_dance", "stage_combat",
    ]);
    strictEqual(model.days[0].categories[0].bars.length, 1);
    strictEqual(model.days[0].categories[1].bars.length, 0);
    strictEqual(model.days[0].categories[2].bars.length, 0);
  });

  it("uses 15-minute slots for rounded start and end positions", () => {
    const model = buildRehearsalPrintModel([
      rehearsal("rounded", "2026-11-15", "12:10", "13:20", "acting"),
    ]);
    const bar = model.days[0].categories[0].bars[0];
    strictEqual(model.axisStartMinutes, 12 * 60);
    strictEqual(bar.leftSlot, 0);
    strictEqual(bar.slotSpan, 6);
  });

  it("assigns overlapping rehearsals in one category to separate lanes", () => {
    const model = buildRehearsalPrintModel([
      rehearsal("first", "2026-11-15", "13:00", "15:00", "acting"),
      rehearsal("second", "2026-11-15", "14:00", "16:00", "acting"),
      rehearsal("third", "2026-11-15", "16:00", "17:00", "acting"),
    ]);
    const category = model.days[0].categories[0];
    strictEqual(category.bars.length, 3);
    strictEqual(category.laneCount, 2);
    deepStrictEqual(category.bars.map((bar) => bar.lane), [0, 1, 0]);
  });

  it("expands before noon and after 19:00 without clipping", () => {
    const model = buildRehearsalPrintModel([
      rehearsal("early", "2026-11-15", "09:30", "11:00", "acting"),
      rehearsal("late", "2026-11-16", "18:30", "21:15", "meeting"),
    ]);
    strictEqual(model.axisStartMinutes, 9 * 60);
    strictEqual(model.axisEndMinutes, 22 * 60);
    strictEqual(model.days[0].categories[0].bars[0].leftSlot, 2);
    strictEqual(model.days[1].categories.find((category) => category.type === "meeting").bars[0].slotSpan, 11);
  });

  it("keeps an omitted end time unset and gives it one visual slot", () => {
    const model = buildRehearsalPrintModel([
      rehearsal("open-ended", "2026-11-15", "13:07", null, "acting"),
    ]);
    const bar = model.days[0].categories[0].bars[0];
    strictEqual(bar.endTime, null);
    strictEqual(bar.leftSlot, 4);
    strictEqual(bar.slotSpan, 1);
  });

  it("does not calculate a same-day width from an end time on another date", () => {
    const item = rehearsal("overnight", "2026-11-15", "23:30", null, "acting");
    item.endAt = Timestamp.fromDate(new Date("2026-11-16T01:00:00+09:00"));
    const model = buildRehearsalPrintModel([item]);
    const bar = model.days[0].categories[0].bars[0];

    strictEqual(bar.endsOnAnotherDate, true);
    strictEqual(bar.endTime, "01:00");
    strictEqual(bar.slotSpan, 1);
    strictEqual(model.axisEndMinutes, 24 * 60);
  });
});
