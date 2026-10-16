import {
  buildRehearsalValues,
  type Rehearsal,
  type RehearsalInput,
  type RehearsalType,
} from "./rehearsals.ts";
import type {
  ImportedReservationRow,
  ImportedReservationWarning,
  RehearsalImportResponse,
} from "./rehearsal-import.ts";

export type RehearsalImportDraft = {
  sourceRow: number;
  status: ImportedReservationRow["status"];
  statusText: string;
  selected: boolean;
  warnings: ImportedReservationWarning[];
  rawText: string;
  input: RehearsalInput;
};

export type RehearsalImportDrafts = {
  candidates: RehearsalImportDraft[];
  cancelled: ImportedReservationRow[];
  warnings: string[];
};

export function inferRehearsalTypeFromVenue(venue: string | null | undefined): RehearsalType {
  const normalized = venue?.normalize("NFKC") ?? "";
  if (normalized.includes("和室")) return "japanese_dance";
  if (normalized.includes("南湖倉庫")) return "stage_combat";
  return "acting";
}

function rowToDraft(row: ImportedReservationRow): RehearsalImportDraft {
  return {
    sourceRow: row.sourceRow,
    status: row.status,
    statusText: row.statusText,
    selected: row.status === "reserved",
    warnings: row.warnings,
    rawText: row.rawText,
    input: {
      date: row.date ?? "",
      startTime: row.startTime ?? "",
      endTime: row.endTime ?? "",
      type: inferRehearsalTypeFromVenue(row.venue),
      customType: "",
      venue: row.venue ?? "",
      content: "",
      note: "",
    },
  };
}

export function createRehearsalImportDrafts(response: RehearsalImportResponse): RehearsalImportDrafts {
  return {
    candidates: response.rows.filter((row) => row.status !== "cancelled").map(rowToDraft),
    cancelled: response.rows.filter((row) => row.status === "cancelled"),
    warnings: response.warnings,
  };
}

export function getRehearsalInputError(input: RehearsalInput): string | null {
  try {
    buildRehearsalValues(input);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "入力内容を確認してください";
  }
}

export function validateRehearsalImportDrafts(drafts: RehearsalImportDraft[]): {
  inputs: RehearsalInput[];
  errors: Array<{ sourceRow: number; message: string }>;
} {
  const selected = drafts.filter((draft) => draft.selected && draft.status !== "cancelled");
  const errors = selected.flatMap((draft) => {
    const message = getRehearsalInputError(draft.input);
    return message ? [{ sourceRow: draft.sourceRow, message }] : [];
  });
  return { inputs: selected.map((draft) => draft.input), errors };
}

export function hasExistingRehearsalDuplicate(input: RehearsalInput, rehearsals: Rehearsal[]): boolean {
  let values;
  try {
    values = buildRehearsalValues(input);
  } catch {
    return false;
  }
  return rehearsals.some((rehearsal) => rehearsal.startAt.toMillis() === values.startAt.toMillis()
    && rehearsal.venue.trim() === values.venue);
}
