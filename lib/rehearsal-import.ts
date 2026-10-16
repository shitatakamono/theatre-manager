import type { ProjectRole } from "./auth.ts";

export const REHEARSAL_IMPORT_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const REHEARSAL_IMPORT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type RehearsalImportImageType = typeof REHEARSAL_IMPORT_IMAGE_TYPES[number];

export function canUseRehearsalScreenshotImport(
  role?: ProjectRole | null
): role is "owner" {
  return role === "owner";
}

export type ImportedReservationStatus = "reserved" | "cancelled" | "unknown";
export type ImportedReservationConfidence = "high" | "medium" | "low";
export type ImportedReservationWarning =
  | "status_unclear"
  | "date_unreadable"
  | "era_mismatch"
  | "time_unreadable"
  | "venue_missing"
  | "low_image_quality";

export type ImportedReservationRow = {
  sourceRow: number;
  status: ImportedReservationStatus;
  statusText: string;
  applicationNumber: string | null;
  rawDateTime: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: string | null;
  confidence: ImportedReservationConfidence;
  warnings: ImportedReservationWarning[];
  rawText: string;
};

export type RehearsalImportResponse = {
  source: "chigasaki_public_facility_reservation";
  rows: ImportedReservationRow[];
  warnings: string[];
};

export class RehearsalImportSchemaError extends Error {
  constructor() {
    super("OpenAIから受け取った解析結果の形式が不正です");
    this.name = "RehearsalImportSchemaError";
  }
}

export class RehearsalImportProviderError extends Error {
  constructor() {
    super("画像解析サービスを利用できませんでした");
    this.name = "RehearsalImportProviderError";
  }
}

export class RehearsalImportTimeoutError extends Error {
  constructor() {
    super("画像解析がタイムアウトしました");
    this.name = "RehearsalImportTimeoutError";
  }
}

const statuses = new Set<ImportedReservationStatus>(["reserved", "cancelled", "unknown"]);
const confidences = new Set<ImportedReservationConfidence>(["high", "medium", "low"]);
const warningValues = new Set<ImportedReservationWarning>([
  "status_unclear", "date_unreadable", "era_mismatch", "time_unreadable",
  "venue_missing", "low_image_quality",
]);

const nullableStringSchema = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

export const REHEARSAL_IMPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: { type: "string", enum: ["chigasaki_public_facility_reservation"] },
    rows: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceRow: { type: "integer" },
          status: { type: "string", enum: ["reserved", "cancelled", "unknown"] },
          statusText: { type: "string" },
          applicationNumber: nullableStringSchema,
          rawDateTime: { type: "string" },
          date: nullableStringSchema,
          startTime: nullableStringSchema,
          endTime: nullableStringSchema,
          venue: nullableStringSchema,
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          warnings: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "status_unclear", "date_unreadable", "era_mismatch", "time_unreadable",
                "venue_missing", "low_image_quality",
              ],
            },
          },
          rawText: { type: "string" },
        },
        required: [
          "sourceRow", "status", "statusText", "applicationNumber", "rawDateTime", "date",
          "startTime", "endTime", "venue", "confidence", "warnings", "rawText",
        ],
      },
    },
    warnings: { type: "array", items: { type: "string" } },
  },
  required: ["source", "rows", "warnings"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

export function parseRehearsalImportResponse(value: unknown): RehearsalImportResponse {
  if (!isRecord(value)
    || value.source !== "chigasaki_public_facility_reservation"
    || !Array.isArray(value.rows)
    || !Array.isArray(value.warnings)
    || !value.warnings.every((warning) => typeof warning === "string")) {
    throw new RehearsalImportSchemaError();
  }

  const rows = value.rows.map((candidate) => {
    if (!isRecord(candidate)
      || !Number.isInteger(candidate.sourceRow)
      || (candidate.sourceRow as number) < 1
      || typeof candidate.status !== "string"
      || !statuses.has(candidate.status as ImportedReservationStatus)
      || typeof candidate.statusText !== "string"
      || !isNullableString(candidate.applicationNumber)
      || typeof candidate.rawDateTime !== "string"
      || !isNullableString(candidate.date)
      || !isNullableString(candidate.startTime)
      || !isNullableString(candidate.endTime)
      || !isNullableString(candidate.venue)
      || typeof candidate.confidence !== "string"
      || !confidences.has(candidate.confidence as ImportedReservationConfidence)
      || !Array.isArray(candidate.warnings)
      || !candidate.warnings.every((warning) => typeof warning === "string" && warningValues.has(warning as ImportedReservationWarning))
      || typeof candidate.rawText !== "string") {
      throw new RehearsalImportSchemaError();
    }
    return candidate as ImportedReservationRow;
  });

  return { source: value.source, rows, warnings: value.warnings as string[] };
}

export function statusFromText(statusText: string): ImportedReservationStatus {
  const normalized = statusText.normalize("NFKC").trim();
  if (normalized === "予約") return "reserved";
  if (normalized === "取消") return "cancelled";
  return "unknown";
}

function addWarning(
  warnings: ImportedReservationWarning[],
  warning: ImportedReservationWarning
): ImportedReservationWarning[] {
  return warnings.includes(warning) ? warnings : [...warnings, warning];
}

function validDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTime(value: string): boolean {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59);
}

function westernDateFromRaw(raw: string): string | null {
  const match = raw.normalize("NFKC").match(/(\d{4})(?:\s*\([^)]*\))?\s*[年/-]\s*(\d{1,2})\s*[月/-]\s*(\d{1,2})\s*日?/);
  if (!match) return null;
  const value = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return validDate(value) ? value : null;
}

function weekdayMismatch(raw: string, dateValue: string): boolean {
  const match = raw.normalize("NFKC").match(/[（(]([日月火水木金土])[）)]/);
  if (!match || !validDate(dateValue)) return false;
  const [year, month, day] = dateValue.split("-").map(Number);
  return "日月火水木金土"[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] !== match[1];
}

export function revalidateRehearsalImportResponse(
  response: RehearsalImportResponse
): RehearsalImportResponse {
  const topWarnings = [...response.warnings];
  const rows = response.rows.map((row) => {
    let warnings = [...row.warnings];
    const status = statusFromText(row.statusText);
    if (status === "unknown") warnings = addWarning(warnings, "status_unclear");

    const rawWesternDate = westernDateFromRaw(row.rawDateTime);
    let date = rawWesternDate ?? row.date;
    if (!date || !validDate(date)) {
      date = null;
      warnings = addWarning(warnings, "date_unreadable");
    }

    const normalizedRaw = row.rawDateTime.normalize("NFKC");
    const reiwa = normalizedRaw.match(/令和\s*(元|\d+)\s*\)?\s*年/);
    const westernYear = rawWesternDate ? Number(rawWesternDate.slice(0, 4)) : date ? Number(date.slice(0, 4)) : null;
    if (reiwa && westernYear !== null) {
      const reiwaYear = reiwa[1] === "元" ? 1 : Number(reiwa[1]);
      if (westernYear !== 2018 + reiwaYear) warnings = addWarning(warnings, "era_mismatch");
    }
    if (date && weekdayMismatch(row.rawDateTime, date)) {
      topWarnings.push(`行${row.sourceRow}: 曜日表記が日付と一致しません`);
    }

    let startTime = row.startTime;
    let endTime = row.endTime;
    if (!startTime || !validTime(startTime)) {
      startTime = null;
      warnings = addWarning(warnings, "time_unreadable");
    }
    if (endTime !== null && !validTime(endTime)) {
      endTime = null;
      warnings = addWarning(warnings, "time_unreadable");
    }
    if (startTime && endTime && endTime <= startTime) {
      endTime = null;
      warnings = addWarning(warnings, "time_unreadable");
    }

    const venue = row.venue?.trim() || null;
    if (!venue) warnings = addWarning(warnings, "venue_missing");

    return {
      ...row,
      status,
      applicationNumber: row.applicationNumber?.trim() || null,
      date,
      startTime,
      endTime,
      venue,
      warnings,
    };
  });

  return { ...response, rows, warnings: [...new Set(topWarnings)] };
}

export function detectImageMimeType(bytes: Uint8Array): RehearsalImportImageType | null {
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    return "image/webp";
  }
  return null;
}
