import { deepStrictEqual, equal, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RehearsalImportSchemaError,
  canUseRehearsalScreenshotImport,
  detectImageMimeType,
  parseRehearsalImportResponse,
  revalidateRehearsalImportResponse,
  statusFromText,
} from "../lib/rehearsal-import.ts";
import {
  createRehearsalImportDrafts,
  inferRehearsalTypeFromVenue,
  validateRehearsalImportDrafts,
} from "../lib/rehearsal-import-drafts.ts";

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
  return { source: "chigasaki_public_facility_reservation", rows: [row()], warnings: [], ...overrides };
}

describe("reservation result validation", () => {
  it("uses exact NFKC-normalized reservation and cancellation statuses", () => {
    equal(statusFromText("　予約　"), "reserved");
    equal(statusFromText("取消"), "cancelled");
    equal(statusFromText("予 約"), "unknown");
    equal(statusFromText("予約済"), "unknown");
  });

  it("parses multiple rows and makes only reservations selected candidates", () => {
    const parsed = revalidateRehearsalImportResponse(parseRehearsalImportResponse(response({ rows: [
      row({ sourceRow: 1, statusText: "予約" }),
      row({ sourceRow: 2, status: "reserved", statusText: "取消" }),
      row({ sourceRow: 3, status: "reserved", statusText: "判読不能" }),
    ] })));
    const drafts = createRehearsalImportDrafts(parsed);
    deepStrictEqual(drafts.candidates.map(({ sourceRow, selected }) => [sourceRow, selected]), [[1, true], [3, false]]);
    deepStrictEqual(drafts.cancelled.map(({ sourceRow }) => sourceRow), [2]);
    equal(validateRehearsalImportDrafts(drafts.candidates).inputs.length, 1);
  });

  it("checks Reiwa consistency and validates impossible dates and times", () => {
    const mismatch = revalidateRehearsalImportResponse(response({ rows: [row({
      rawDateTime: "2026（令和7）年10月25日（日）12:00-16:00",
    })] }));
    equal(mismatch.rows[0].warnings.includes("era_mismatch"), true);
    const result = revalidateRehearsalImportResponse(response({ rows: [row({
      rawDateTime: "2026（令和7）年2月30日（日）25:00-11:00",
      date: "2026-02-30",
      startTime: "25:00",
      endTime: "11:00",
      venue: " ",
    })] }));
    equal(result.rows[0].date, null);
    equal(result.rows[0].startTime, null);
    equal(result.rows[0].venue, null);
    equal(result.rows[0].warnings.includes("date_unreadable"), true);
    equal(result.rows[0].warnings.includes("time_unreadable"), true);
  });

  it("rejects provider output outside the fixed schema", () => {
    throws(() => parseRehearsalImportResponse(response({ rows: [row({ confidence: "certain" })] })), RehearsalImportSchemaError);
  });
});

describe("rehearsal import mapping", () => {
  it("reuses the supported rehearsal types for venue inference", () => {
    equal(inferRehearsalTypeFromVenue("市民文化会館 和室"), "japanese_dance");
    equal(inferRehearsalTypeFromVenue("南湖倉庫 1階"), "stage_combat");
    equal(inferRehearsalTypeFromVenue("BF2集会室"), "acting");
  });

  it("keeps incomplete reservation rows editable but unfit for saving", () => {
    const drafts = createRehearsalImportDrafts(response({ rows: [row({ date: null, startTime: null })] }));
    equal(drafts.candidates[0].selected, true);
    equal(validateRehearsalImportDrafts(drafts.candidates).errors.length, 1);
  });

  it("enables the import entry point for owners only", () => {
    equal(canUseRehearsalScreenshotImport("owner"), true);
    equal(canUseRehearsalScreenshotImport("editor"), false);
    equal(canUseRehearsalScreenshotImport("viewer"), false);
    equal(canUseRehearsalScreenshotImport(null), false);
  });
});

describe("image signature validation", () => {
  it("accepts only PNG, JPEG and WEBP signatures", () => {
    equal(detectImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
    equal(detectImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff])), "image/jpeg");
    equal(detectImageMimeType(new TextEncoder().encode("RIFF1234WEBP")), "image/webp");
    equal(detectImageMimeType(new TextEncoder().encode("invalid")), null);
  });
});
