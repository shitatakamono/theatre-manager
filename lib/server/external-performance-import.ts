import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  classifyExternalPerformanceDuplicate,
  EXTERNAL_PERFORMANCE_CSV_MAX_ROWS,
} from "../external-performance-csv.ts";
import {
  buildExternalPerformanceValues,
  type ExternalPerformanceInput,
  type ExternalPerformanceValues,
} from "../external-performances.ts";
import { adminDb } from "./firebase-admin.ts";

export type ExternalPerformanceImportRequestRow = {
  sourceRow: number;
  input: ExternalPerformanceInput;
  confirmPossibleDuplicate: boolean;
};

export type ExternalPerformanceImportRowResult = {
  sourceRow: number;
  status: "imported" | "skipped" | "failed";
  reason?: "duplicate" | "possible_duplicate" | "invalid" | "write_failed";
  message: string;
};

export type ExternalPerformanceImportResult = {
  imported: number;
  skipped: number;
  failed: number;
  rows: ExternalPerformanceImportRowResult[];
};

export class ExternalPerformanceImportError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "ExternalPerformanceImportError";
    this.code = code;
    this.status = status;
  }
}

function requiredId(value: string, label: string): string {
  const result = value.trim();
  if (!result || result.includes("/") || result.length > 1500) {
    throw new ExternalPerformanceImportError("invalid_request", 400, `${label}が不正です`);
  }
  return result;
}

function valuesFromDocument(data: FirebaseFirestore.DocumentData): ExternalPerformanceValues {
  return {
    organizationName: typeof data.organizationName === "string" ? data.organizationName : "",
    performanceName: typeof data.performanceName === "string" ? data.performanceName : "",
    startDate: typeof data.startDate === "string" ? data.startDate : "",
    endDate: typeof data.endDate === "string" ? data.endDate : "",
    venue: typeof data.venue === "string" ? data.venue : "",
    contact: typeof data.contact === "string" ? data.contact : "",
    contactMethod: typeof data.contactMethod === "string" ? data.contactMethod : "",
    contactPerson: typeof data.contactPerson === "string" ? data.contactPerson : "",
    note: typeof data.note === "string" ? data.note : "",
    insertion: null,
  };
}

function actorName(data: FirebaseFirestore.DocumentData | undefined): string {
  const value = data?.displayName;
  return typeof value === "string" && value.trim() ? value.trim() : "システム利用者";
}

async function requireEditor(db: Firestore, projectId: string, uid: string): Promise<string> {
  const member = await db.collection("projects").doc(projectId).collection("members").doc(uid).get();
  const role = member.data()?.role;
  if (!member.exists || (role !== "owner" && role !== "editor")) {
    throw new ExternalPerformanceImportError("forbidden", 403, "CSVを取り込む権限がありません");
  }
  return actorName(member.data());
}

export async function importExternalPerformanceRows(input: {
  uid: string;
  projectId: string;
  rows: ExternalPerformanceImportRequestRow[];
  db?: Firestore;
}): Promise<ExternalPerformanceImportResult> {
  const db = input.db ?? adminDb;
  const uid = requiredId(input.uid, "利用者情報");
  const projectId = requiredId(input.projectId, "公演情報");
  if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > EXTERNAL_PERFORMANCE_CSV_MAX_ROWS) {
    throw new ExternalPerformanceImportError("invalid_request", 400, `取込対象は1〜${EXTERNAL_PERFORMANCE_CSV_MAX_ROWS}件にしてください`);
  }
  const name = await requireEditor(db, projectId, uid);
  const projectRef = db.collection("projects").doc(projectId);
  const records = projectRef.collection("externalPerformances");
  const importStateRef = projectRef.collection("externalPerformanceImportState").doc("current");
  const results: ExternalPerformanceImportRowResult[] = [];

  for (const row of input.rows) {
    if (!Number.isInteger(row.sourceRow) || row.sourceRow < 2) {
      results.push({ sourceRow: row.sourceRow, status: "failed", reason: "invalid", message: "CSVの行番号が不正です" });
      continue;
    }
    let values: ExternalPerformanceValues;
    try {
      values = buildExternalPerformanceValues({ ...row.input, insertion: null });
    } catch (error) {
      results.push({
        sourceRow: row.sourceRow, status: "failed", reason: "invalid",
        message: error instanceof Error ? error.message : "入力内容が不正です",
      });
      continue;
    }

    try {
      const result = await db.runTransaction(async (transaction): Promise<ExternalPerformanceImportRowResult> => {
        const memberRef = projectRef.collection("members").doc(uid);
        const [member, importState, existing] = await Promise.all([
          transaction.get(memberRef), transaction.get(importStateRef), transaction.get(records),
        ]);
        const role = member.data()?.role;
        if (!member.exists || (role !== "owner" && role !== "editor")) {
          throw new ExternalPerformanceImportError("forbidden", 403, "CSVを取り込む権限がありません");
        }
        const duplicate = classifyExternalPerformanceDuplicate(values, existing.docs.map((item) => valuesFromDocument(item.data())));
        if (duplicate === "duplicate") {
          return { sourceRow: row.sourceRow, status: "skipped", reason: duplicate, message: "同じ公演がすでに登録されています" };
        }
        if (duplicate === "possible_duplicate" && !row.confirmPossibleDuplicate) {
          return { sourceRow: row.sourceRow, status: "skipped", reason: duplicate, message: "重複の可能性があるため登録しませんでした" };
        }

        const now = Timestamp.now();
        const recordRef = records.doc();
        const logRef = projectRef.collection("activityLogs").doc();
        transaction.create(recordRef, {
          ...values, revision: 0, createdAt: now, updatedAt: now, createdByUid: uid, updatedByUid: uid,
        });
        transaction.create(logRef, {
          actorUid: uid, actorName: name, action: "create",
          section: "externalPerformances", sectionLabel: "他団体公演・折込",
          changedFields: ["CSVから他団体公演を追加"], createdAt: now,
        });
        transaction.set(importStateRef, {
          revision: typeof importState.data()?.revision === "number" ? importState.data()!.revision + 1 : 1,
          updatedAt: now,
        });
        return { sourceRow: row.sourceRow, status: "imported", message: "登録しました" };
      });
      results.push(result);
    } catch (error) {
      if (error instanceof ExternalPerformanceImportError) throw error;
      results.push({ sourceRow: row.sourceRow, status: "failed", reason: "write_failed", message: "保存できませんでした" });
    }
  }

  return {
    imported: results.filter(({ status }) => status === "imported").length,
    skipped: results.filter(({ status }) => status === "skipped").length,
    failed: results.filter(({ status }) => status === "failed").length,
    rows: results,
  };
}
