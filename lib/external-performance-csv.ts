import {
  buildExternalPerformanceValues,
  type ExternalPerformanceInput,
  type ExternalPerformanceValues,
} from "./external-performances.ts";

export const EXTERNAL_PERFORMANCE_CSV_MAX_ROWS = 100;

const REQUIRED_HEADERS = ["団体名", "公演名", "会場", "開始日", "終了日", "備考"] as const;
const OPTIONAL_HEADERS = ["日程原文"] as const;

export type ExternalPerformanceCsvRowStatus = "ready" | "duplicate" | "possible_duplicate" | "error";

export type ExternalPerformanceCsvRow = {
  sourceRow: number;
  status: ExternalPerformanceCsvRowStatus;
  message: string;
  organizationName: string;
  performanceName: string;
  venue: string;
  startDate: string;
  endDate: string;
  note: string;
  input?: ExternalPerformanceInput;
};

export type ExternalPerformanceCsvAnalysis = {
  total: number;
  ready: number;
  duplicates: number;
  possibleDuplicates: number;
  errors: number;
  rows: ExternalPerformanceCsvRow[];
};

type ParsedCsvRow = { sourceRow: number; cells: string[] };

function parseCsvRecords(source: string): ParsedCsvRow[] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: ParsedCsvRow[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;

  const pushRow = () => {
    cells.push(field);
    if (cells.some((cell) => cell.trim() !== "")) rows.push({ sourceRow: rowStart, cells });
    cells = [];
    field = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else {
        field += character;
        if (character === "\n") line += 1;
      }
      continue;
    }
    if (character === '"') {
      if (field.length > 0) throw new Error(`CSV ${line}行目の引用符の位置が不正です`);
      quoted = true;
    } else if (character === ",") {
      cells.push(field); field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRow(); line += 1; rowStart = line;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error(`CSV ${rowStart}行目の引用符が閉じられていません`);
  if (field.length > 0 || cells.length > 0) pushRow();
  return rows;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("ja-JP");
}

function sameBase(left: ExternalPerformanceValues, right: ExternalPerformanceValues): boolean {
  return normalized(left.organizationName) === normalized(right.organizationName)
    && normalized(left.performanceName) === normalized(right.performanceName)
    && normalized(left.venue) === normalized(right.venue);
}

export function classifyExternalPerformanceDuplicate(
  candidate: ExternalPerformanceValues,
  existing: ExternalPerformanceValues[]
): "duplicate" | "possible_duplicate" | null {
  let possible = false;
  for (const item of existing) {
    if (!sameBase(candidate, item)) continue;
    if (candidate.startDate === item.startDate && candidate.endDate === item.endDate) return "duplicate";
    const datesComplete = Boolean(candidate.startDate && candidate.endDate && item.startDate && item.endDate);
    if (!datesComplete) possible = true;
  }
  return possible ? "possible_duplicate" : null;
}

function appendScheduleText(note: string, scheduleText: string): string {
  const base = note.trim();
  const schedule = scheduleText.trim();
  if (!schedule) return base;
  return [base, `日程原文：${schedule}`].filter(Boolean).join("\n");
}

function emptyDisplayRow(sourceRow: number, cells: string[]): ExternalPerformanceCsvRow {
  return {
    sourceRow, status: "error", message: "CSVの列数が正しくありません",
    organizationName: cells[0]?.trim() ?? "", performanceName: cells[1]?.trim() ?? "",
    venue: cells[2]?.trim() ?? "", startDate: cells[3]?.trim() ?? "",
    endDate: cells[4]?.trim() ?? "", note: cells[5]?.trim() ?? "",
  };
}

export function analyzeExternalPerformanceCsv(
  csv: string,
  existing: ExternalPerformanceValues[] = []
): ExternalPerformanceCsvAnalysis {
  const records = parseCsvRecords(csv);
  if (records.length === 0) throw new Error("CSVにデータがありません");
  const [headerRow, ...dataRows] = records;
  const headers = headerRow.cells.map((cell) => cell.trim());
  if (new Set(headers).size !== headers.length) throw new Error("CSVのヘッダーが重複しています");
  for (const header of REQUIRED_HEADERS) {
    if (!headers.includes(header)) throw new Error(`CSVに「${header}」列がありません`);
  }
  const supported = new Set<string>([...REQUIRED_HEADERS, ...OPTIONAL_HEADERS]);
  const unknown = headers.filter((header) => !supported.has(header));
  if (unknown.length > 0) throw new Error(`対応していない列があります：${unknown.join("、")}`);
  if (dataRows.length === 0) throw new Error("CSVに公演データがありません");
  if (dataRows.length > EXTERNAL_PERFORMANCE_CSV_MAX_ROWS) {
    throw new Error(`CSVは${EXTERNAL_PERFORMANCE_CSV_MAX_ROWS}件以下にしてください`);
  }

  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  const pool = [...existing];
  const rows = dataRows.map((record): ExternalPerformanceCsvRow => {
    if (record.cells.length > headers.length) return emptyDisplayRow(record.sourceRow, record.cells);
    const value = (header: string) => record.cells[index[header]]?.trim() ?? "";
    const display = {
      sourceRow: record.sourceRow,
      organizationName: value("団体名"), performanceName: value("公演名"), venue: value("会場"),
      startDate: value("開始日"), endDate: value("終了日"),
      note: appendScheduleText(value("備考"), value("日程原文")),
    };
    const input: ExternalPerformanceInput = {
      organizationName: display.organizationName,
      performanceName: display.performanceName,
      startDate: display.startDate,
      endDate: display.endDate,
      venue: display.venue,
      note: display.note,
      contact: "", contactMethod: "", contactPerson: "", insertion: null,
    };
    try {
      const values = buildExternalPerformanceValues(input);
      const duplicate = classifyExternalPerformanceDuplicate(values, pool);
      pool.push(values);
      if (duplicate === "duplicate") {
        return { ...display, input, status: duplicate, message: "同じ公演が登録済み、またはCSV内で重複しています" };
      }
      if (duplicate === "possible_duplicate") {
        return { ...display, input, status: duplicate, message: "日程未確定の同じ公演候補があります。登録する場合は確認が必要です" };
      }
      return { ...display, input, status: "ready", message: "登録できます" };
    } catch (error) {
      return { ...display, status: "error", message: error instanceof Error ? error.message : "入力内容が不正です" };
    }
  });
  return {
    total: rows.length,
    ready: rows.filter(({ status }) => status === "ready").length,
    duplicates: rows.filter(({ status }) => status === "duplicate").length,
    possibleDuplicates: rows.filter(({ status }) => status === "possible_duplicate").length,
    errors: rows.filter(({ status }) => status === "error").length,
    rows,
  };
}
