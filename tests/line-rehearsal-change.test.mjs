import { deepStrictEqual, notStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINE_TEXT_MAX_CODE_UNITS,
  aggregateRehearsalChangeEvents,
  buildRehearsalChangeBatchId,
  buildRehearsalChangeDeliveryId,
  buildRehearsalChangeMessages,
  canSuppressWithDayBeforeDelivery,
  extractRehearsalChangeSnapshot,
  getRehearsalChangeBatchWindow,
  shouldRecordRehearsalChange,
} from "../lib/line-rehearsal-change.ts";

const start = new Date("2026-11-15T13:00:00+09:00").getTime();
const end = new Date("2026-11-15T17:00:00+09:00").getTime();
const snap = (overrides = {}) => ({ startAtMillis: start, endAtMillis: end, typeLabel: "芝居", venue: "大原", content: "通し", note: "", cancelled: false, ...overrides });
const event = (id, before, after, occurredAtMillis = 1) => ({ id, projectId: "p", rehearsalId: "r", eventType: before ? after ? "updated" : "deleted" : "created", before, after, occurredAtMillis });

describe("rehearsal change snapshots", () => {
  it("extracts only participant-visible fields and ignores internal-only changes", () => {
    const data = { startAt: { toMillis: () => start }, endAt: { toMillis: () => end }, type: "acting", venue: " 大原 ", content: " 通し ", note: " 連絡 ", revision: 7, updatedByUid: "secret" };
    const snapshot = extractRehearsalChangeSnapshot(data);
    deepStrictEqual(snapshot, snap({ note: "連絡" }));
    strictEqual(shouldRecordRehearsalChange({ before: snapshot, after: extractRehearsalChangeSnapshot({ ...data, revision: 8 }), occurredAtMillis: start }), false);
  });

  it("records current/future visible changes but excludes past rehearsals in JST", () => {
    strictEqual(shouldRecordRehearsalChange({ before: snap(), after: snap({ venue: "海風" }), occurredAtMillis: start }), true);
    strictEqual(shouldRecordRehearsalChange({ before: snap({ startAtMillis: start - 86_400_000 }), after: null, occurredAtMillis: start }), false);
  });
});

describe("rehearsal change aggregation", () => {
  it("collapses A-B-C to A-C and A-B-A/create-delete to no-op", () => {
    const b = snap({ venue: "B" }); const c = snap({ venue: "C" });
    const aggregated = aggregateRehearsalChangeEvents([event("1", snap(), b, 1), event("2", b, c, 2)]);
    strictEqual(aggregated.length, 1); deepStrictEqual(aggregated[0].before, snap()); deepStrictEqual(aggregated[0].after, c);
    strictEqual(aggregateRehearsalChangeEvents([event("1", snap(), b, 1), event("2", b, snap(), 2)]).length, 0);
    strictEqual(aggregateRehearsalChangeEvents([event("1", null, b, 1), event("2", b, null, 2)]).length, 0);
  });

  it("formats creation, deletion, changes, cancellation and cancellation reversal", () => {
    const changes = [
      ...aggregateRehearsalChangeEvents([event("1", null, snap(), 1)]),
      ...aggregateRehearsalChangeEvents([{ ...event("2", snap(), null, 2), rehearsalId: "r2" }]),
      ...aggregateRehearsalChangeEvents([{ ...event("3", snap(), snap({ startAtMillis: start + 86_400_000, venue: "海風", cancelled: true }), 3), rehearsalId: "r3" }]),
      ...aggregateRehearsalChangeEvents([{ ...event("4", snap({ cancelled: true }), snap(), 4), rehearsalId: "r4" }]),
    ];
    const message = buildRehearsalChangeMessages(changes)[0];
    for (const value of ["追加", "削除", "中止になりました", "中止解除"]) strictEqual(message.includes(value), true);
  });

  it("uses one safe summary message when detailed content exceeds LINE's limit", () => {
    const huge = snap({ content: "長".repeat(LINE_TEXT_MAX_CODE_UNITS) });
    const messages = buildRehearsalChangeMessages(aggregateRehearsalChangeEvents([event("1", snap(), huge)]));
    strictEqual(messages.length, 1); strictEqual(messages[0].length <= LINE_TEXT_MAX_CODE_UNITS, true); strictEqual(messages[0].includes("変更内容が多いため"), true);
  });
});

describe("rehearsal change windows and identity", () => {
  it("uses non-overlapping (previous cutoff, current cutoff] windows", () => {
    const noon = getRehearsalChangeBatchWindow({ cutoff: new Date("2026-11-15T12:01:00+09:00"), slot: "12" });
    const evening = getRehearsalChangeBatchWindow({ cutoff: new Date("2026-11-15T20:01:00+09:00"), slot: "20" });
    strictEqual(noon.endInclusiveMillis, evening.startExclusiveMillis);
    strictEqual(noon.startExclusiveMillis, new Date("2026-11-14T20:00:00+09:00").getTime());
    const nextNoon = getRehearsalChangeBatchWindow({ cutoff: new Date("2026-11-16T12:01:00+09:00"), slot: "12" });
    strictEqual(evening.endInclusiveMillis, nextNoon.startExclusiveMillis);
  });

  it("creates opaque stable batch/delivery IDs", () => {
    const batch = buildRehearsalChangeBatchId("project", "window");
    strictEqual(batch, buildRehearsalChangeBatchId("project", "window"));
    const delivery = buildRehearsalChangeDeliveryId(batch, "uid");
    strictEqual(delivery.includes("uid"), false); notStrictEqual(delivery, buildRehearsalChangeDeliveryId(batch, "other"));
  });

  it("suppresses only an explicitly sent day-before delivery covering every affected date", () => {
    strictEqual(canSuppressWithDayBeforeDelivery({ allAffectedDates: ["2026-11-16"], tomorrowDate: "2026-11-16", dayBeforeDeliverySent: true }), true);
    strictEqual(canSuppressWithDayBeforeDelivery({ allAffectedDates: ["2026-11-16"], tomorrowDate: "2026-11-16", dayBeforeDeliverySent: false }), false);
    strictEqual(canSuppressWithDayBeforeDelivery({ allAffectedDates: ["2026-11-16", "2026-11-17"], tomorrowDate: "2026-11-16", dayBeforeDeliverySent: true }), false);
  });
});
