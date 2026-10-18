import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REHEARSAL_IMPORT_MAX_IMAGE_BYTES,
  RehearsalImportSchemaError,
  detectImageMimeType,
  parseRehearsalImportResponse,
  revalidateRehearsalImportResponse,
  statusFromText,
} from "../lib/rehearsal-import.ts";
import {
  createRehearsalImportDrafts,
  hasExistingRehearsalDuplicate,
  inferRehearsalTypeFromVenue,
  validateRehearsalImportDrafts,
} from "../lib/rehearsal-import-drafts.ts";
import { buildRehearsalValues } from "../lib/rehearsals.ts";

function row(overrides = {}) {
  return {
    sourceRow: 1,
    status: "reserved",
    statusText: "予約",
    applicationNumber: "A-1",
    rawDateTime: "2026（令和8）年10月25日（日）12:00-16:00",
    date: "2026-10-25",
    startTime: "12:00",
    endTime: "16:00",
    venue: "茅ヶ崎公園体験学習センター BF2集会室",
    confidence: "high",
    warnings: [],
    rawText: "予約 A-1 2026（令和8）年10月25日（日）12:00-16:00 茅ヶ崎公園体験学習センター BF2集会室",
    ...overrides,
  };
}

function response(overrides = {}) {
  return {
    source: "chigasaki_public_facility_reservation",
    rows: [row()],
    warnings: [],
    ...overrides,
  };
}

describe("reservation result validation", () => {
  it("uses an exact NFKC-normalized status match", () => {
    equal(statusFromText("　予約　"), "reserved");
    equal(statusFromText("取消"), "cancelled");
    equal(statusFromText("予 約"), "unknown");
    equal(statusFromText("予約済"), "unknown");
  });

  it("overrides a contradictory AI status from statusText", () => {
    const result = revalidateRehearsalImportResponse(response({ rows: [row({ status: "cancelled", statusText: "予約" })] }));
    equal(result.rows[0].status, "reserved");
  });

  it("checks Reiwa consistency and prefers the visible Gregorian date", () => {
    const result = revalidateRehearsalImportResponse(response({
      rows: [row({ rawDateTime: "2026（令和7）年10月25日（日）12:00-16:00", date: "2025-10-25" })],
    }));
    equal(result.rows[0].date, "2026-10-25");
    equal(result.rows[0].warnings.includes("era_mismatch"), true);
  });

  it("reports a weekday mismatch without changing the date", () => {
    const result = revalidateRehearsalImportResponse(response({
      rows: [row({ rawDateTime: "2026年10月25日（月）12:00-16:00" })],
    }));
    equal(result.rows[0].date, "2026-10-25");
    equal(result.warnings.includes("行1: 曜日表記が日付と一致しません"), true);
  });

  it("invalidates impossible dates and times without inventing values", () => {
    const result = revalidateRehearsalImportResponse(response({
      rows: [row({ rawDateTime: "不明", date: "2026-02-30", startTime: "25:00", endTime: "11:00", venue: "  " })],
    }));
    equal(result.rows[0].date, null);
    equal(result.rows[0].startTime, null);
    equal(result.rows[0].venue, null);
    deepStrictEqual(result.rows[0].warnings.sort(), ["date_unreadable", "time_unreadable", "venue_missing"]);
  });

  it("invalidates an end time that is not later than the start", () => {
    const result = revalidateRehearsalImportResponse(response({ rows: [row({ startTime: "16:00", endTime: "12:00" })] }));
    equal(result.rows[0].startTime, "16:00");
    equal(result.rows[0].endTime, null);
    equal(result.rows[0].warnings.includes("time_unreadable"), true);
  });

  it("rejects output that does not match the runtime schema", () => {
    throws(() => parseRehearsalImportResponse(response({ rows: [row({ confidence: "certain" })] })), RehearsalImportSchemaError);
  });
});

describe("image signature validation", () => {
  it("detects PNG, JPEG and WEBP magic bytes", () => {
    equal(detectImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
    equal(detectImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb])), "image/jpeg");
    equal(detectImageMimeType(new TextEncoder().encode("RIFF1234WEBP")), "image/webp");
    equal(detectImageMimeType(new TextEncoder().encode("not an image")), null);
  });

  it("uses a four MiB limit", () => {
    equal(REHEARSAL_IMPORT_MAX_IMAGE_BYTES, 4 * 1024 * 1024);
  });
});

describe("rehearsal import confirmation drafts", () => {
  it("infers a deterministic initial type from the venue", () => {
    equal(inferRehearsalTypeFromVenue("市民文化会館 和室"), "japanese_dance");
    equal(inferRehearsalTypeFromVenue("南湖倉庫 1階"), "stage_combat");
    equal(inferRehearsalTypeFromVenue("BF2集会室"), "acting");
  });

  it("keeps inferred types editable by the user", () => {
    const drafts = createRehearsalImportDrafts(response());
    drafts.candidates[0].input.type = "meeting";
    deepStrictEqual(validateRehearsalImportDrafts(drafts.candidates).inputs[0].type, "meeting");
  });

  it("selects reservations and excludes cancelled and unknown rows by default", () => {
    const result = createRehearsalImportDrafts(response({ rows: [
      row({ sourceRow: 1, status: "reserved", statusText: "予約" }),
      row({ sourceRow: 2, status: "cancelled", statusText: "取消" }),
      row({ sourceRow: 3, status: "unknown", statusText: "判読不能" }),
    ] }));
    deepStrictEqual(result.candidates.map(({ sourceRow, selected }) => [sourceRow, selected]), [[1, true], [3, false]]);
    deepStrictEqual(result.cancelled.map(({ sourceRow }) => sourceRow), [2]);
    equal(validateRehearsalImportDrafts(result.candidates).inputs.length, 1);
  });

  it("rejects every selected row when any selected input is invalid", () => {
    const drafts = createRehearsalImportDrafts(response());
    drafts.candidates[0].input.date = "";
    const validation = validateRehearsalImportDrafts(drafts.candidates);
    equal(validation.inputs.length, 1);
    equal(validation.errors[0].sourceRow, 1);
  });

  it("warns on matching start time and venue without preventing validation", () => {
    const drafts = createRehearsalImportDrafts(response());
    const values = buildRehearsalValues(drafts.candidates[0].input);
    const existing = [{ id: "existing", ...values, revision: 0, createdByUid: "a", updatedByUid: "a" }];
    equal(hasExistingRehearsalDuplicate(drafts.candidates[0].input, existing), true);
    equal(validateRehearsalImportDrafts(drafts.candidates).errors.length, 0);
  });
});
