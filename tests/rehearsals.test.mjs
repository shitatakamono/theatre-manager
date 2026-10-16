import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRehearsalValues,
  getRehearsalChangedFields,
  getNextRehearsals,
  getRehearsalTypeLabel,
  normalizeStoredRehearsalType,
  REHEARSAL_TYPE_OPTIONS,
  timestampToTokyoInput,
  toTokyoTimestamp,
} from "../lib/rehearsals.ts";

const baseInput = {
  date: "2026-11-15",
  startTime: "13:00",
  endTime: "16:00",
  type: "acting",
  customType: "",
  venue: "会議室A",
  content: "立ち稽古",
  note: "台本持参",
};

describe("rehearsal values", () => {
  it("converts Japanese local date and time to one Timestamp without duplicate date fields", () => {
    const value = buildRehearsalValues(baseInput);
    strictEqual(value.startAt.toDate().toISOString(), "2026-11-15T04:00:00.000Z");
    strictEqual(value.endAt?.toDate().toISOString(), "2026-11-15T07:00:00.000Z");
    deepStrictEqual(timestampToTokyoInput(value.startAt), { date: "2026-11-15", time: "13:00" });
    strictEqual("date" in value, false);
    strictEqual("startTime" in value, false);
  });

  it("accepts an omitted end time and rejects an end time at or before start", () => {
    strictEqual(buildRehearsalValues({ ...baseInput, endTime: "" }).endAt, null);
    throws(() => buildRehearsalValues({ ...baseInput, endTime: "13:00" }), /終了時刻/);
    throws(() => buildRehearsalValues({ ...baseInput, endTime: "12:59" }), /終了時刻/);
  });

  it("requires customType only for other", () => {
    throws(() => buildRehearsalValues({ ...baseInput, type: "other", customType: "" }), /種別名/);
    throws(() => buildRehearsalValues({ ...baseInput, customType: "自主稽古" }), /その他/);
    strictEqual(getRehearsalTypeLabel("other", "自主稽古"), "自主稽古");
  });

  it("keeps the five fixed types in one ordered definition", () => {
    deepStrictEqual(REHEARSAL_TYPE_OPTIONS, [
      { value: "acting", label: "芝居" },
      { value: "stage_combat", label: "殺陣" },
      { value: "japanese_dance", label: "日舞" },
      { value: "meeting", label: "打ち合わせ" },
      { value: "other", label: "その他" },
    ]);
    throws(() => buildRehearsalValues({ ...baseInput, type: "reading" }), /不正/);
    throws(() => buildRehearsalValues({ ...baseInput, type: "run_through" }), /不正/);
  });

  it("reads legacy reading and run-through records as acting without writing them", () => {
    strictEqual(normalizeStoredRehearsalType("reading"), "acting");
    strictEqual(normalizeStoredRehearsalType("run_through"), "acting");
    strictEqual(normalizeStoredRehearsalType("meeting"), "meeting");
  });

  it("returns only changed Japanese field groups", () => {
    const before = buildRehearsalValues(baseInput);
    const after = buildRehearsalValues({ ...baseInput, endTime: "17:00", venue: "和室", content: "" });
    deepStrictEqual(getRehearsalChangedFields(before, after), ["日時", "場所", "内容"]);
    deepStrictEqual(getRehearsalChangedFields(before, buildRehearsalValues(baseInput)), []);
  });

  it("rejects invalid calendar values rather than normalizing them", () => {
    throws(() => toTokyoTimestamp("2026-02-30", "13:00"), /正しく/);
    throws(() => toTokyoTimestamp("2026-11-15", "25:00"), /正しく/);
  });

  it("returns every rehearsal sharing the earliest start time", () => {
    const early = buildRehearsalValues(baseInput);
    const late = buildRehearsalValues({ ...baseInput, startTime: "14:00", endTime: "17:00" });
    const items = [
      { id: "late", ...late },
      { id: "early-a", ...early },
      { id: "early-b", ...early },
    ];
    deepStrictEqual(getNextRehearsals(items).map((item) => item.id), ["early-a", "early-b"]);
  });
});
