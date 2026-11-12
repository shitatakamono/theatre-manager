import { deepStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeExternalPerformanceCsv } from "../lib/external-performance-csv.ts";

const header = "団体名,公演名,会場,開始日,終了日,備考,日程原文";

function existing(overrides = {}) {
  return {
    organizationName: "劇団A", performanceName: "春公演", venue: "会場A",
    startDate: "2027-03-01", endDate: "2027-03-03", contact: "", contactMethod: "",
    contactPerson: "", note: "", insertion: null, ...overrides,
  };
}

describe("external performance CSV", () => {
  it("parses UTF-8 BOM, quoted commas, quotes, and embedded newlines", () => {
    const csv = `\uFEFF${header}\r\n"劇団,A","春""公演",会場A,2027-03-01,2027-03-03,"一行目\n二行目",調整中`;
    const result = analyzeExternalPerformanceCsv(csv);
    strictEqual(result.total, 1);
    strictEqual(result.ready, 1);
    strictEqual(result.rows[0].organizationName, "劇団,A");
    strictEqual(result.rows[0].performanceName, "春\"公演");
    strictEqual(result.rows[0].note, "一行目\n二行目\n日程原文：調整中");
    strictEqual(result.rows[0].input.insertion, null);
  });

  it("loads 26 candidates", () => {
    const rows = Array.from({ length: 26 }, (_, index) => `劇団${index},公演${index},会場${index},2027-04-01,2027-04-02,,`).join("\n");
    const result = analyzeExternalPerformanceCsv(`${header}\n${rows}`);
    strictEqual(result.total, 26);
    strictEqual(result.ready, 26);
  });

  it("keeps uncertain dates empty and appends the original schedule without losing notes", () => {
    const result = analyzeExternalPerformanceCsv(`${header}\n劇団A,春公演,会場A,,,既存メモ,11月下旬予定`);
    strictEqual(result.rows[0].startDate, "");
    strictEqual(result.rows[0].endDate, "");
    strictEqual(result.rows[0].note, "既存メモ\n日程原文：11月下旬予定");
  });

  it("classifies exact and possible duplicates while allowing another venue", () => {
    const csv = `${header}\n劇団Ａ,春公演,会場A,2027-03-01,2027-03-03,,\n劇団A,春公演,会場A,,,,未定\n劇団A,春公演,会場B,2027-03-01,2027-03-03,,`;
    const result = analyzeExternalPerformanceCsv(csv, [existing()]);
    deepStrictEqual(result.rows.map(({ status }) => status), ["duplicate", "possible_duplicate", "ready"]);
    const unknownDates = analyzeExternalPerformanceCsv(`${header}\n劇団A,春公演,会場A,,,,`, [existing({ startDate: "", endDate: "" })]);
    strictEqual(unknownDates.rows[0].status, "duplicate");
  });

  it("reports missing required values and invalid dates", () => {
    const result = analyzeExternalPerformanceCsv(`${header}\n,公演,会場,2027-02-30,2027-03-01,,`);
    strictEqual(result.errors, 1);
    strictEqual(result.rows[0].status, "error");
    throws(() => analyzeExternalPerformanceCsv("団体名,公演名\n劇団,公演"), /会場/);
  });
});
