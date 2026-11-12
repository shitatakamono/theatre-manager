import type { ExternalPerformanceInput } from "../external-performances.ts";
import {
  ExternalPerformanceImportError,
  type ExternalPerformanceImportRequestRow,
  type ExternalPerformanceImportResult,
} from "./external-performance-import.ts";

type Context = { params: Promise<{ projectId: string }> };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function createExternalPerformanceImportHandler(dependencies: {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  importRows: (input: { uid: string; projectId: string; rows: ExternalPerformanceImportRequestRow[] }) => Promise<ExternalPerformanceImportResult>;
}) {
  return async function POST(request: Request, context: Context): Promise<Response> {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return json({ error: "ログインが必要です", code: "unauthorized" }, 401);
    let uid: string;
    try { ({ uid } = await dependencies.verifyIdToken(bearer)); }
    catch { return json({ error: "認証情報を確認できませんでした", code: "unauthorized" }, 401); }

    const projectId = (await context.params).projectId?.trim();
    if (!projectId || projectId.includes("/") || projectId.length > 1500) {
      return json({ error: "公演情報が不正です", code: "invalid_request" }, 400);
    }
    let body: { rows?: unknown };
    try { body = await request.json() as { rows?: unknown }; }
    catch { return json({ error: "送信内容が不正です", code: "invalid_request" }, 400); }
    if (!Array.isArray(body.rows)) return json({ error: "取込内容が不正です", code: "invalid_request" }, 400);
    const rows = body.rows.map((raw): ExternalPerformanceImportRequestRow | null => {
      if (!raw || typeof raw !== "object") return null;
      const value = raw as Record<string, unknown>;
      if (!value.input || typeof value.input !== "object") return null;
      return {
        sourceRow: value.sourceRow as number,
        input: value.input as ExternalPerformanceInput,
        confirmPossibleDuplicate: value.confirmPossibleDuplicate === true,
      };
    });
    if (rows.some((row) => row === null)) return json({ error: "取込内容が不正です", code: "invalid_request" }, 400);
    try {
      return json(await dependencies.importRows({ uid, projectId, rows: rows as ExternalPerformanceImportRequestRow[] }), 200);
    } catch (error) {
      if (error instanceof ExternalPerformanceImportError) {
        return json({ error: error.message, code: error.code }, error.status);
      }
      console.error("external_performance_csv_import_failed", { name: error instanceof Error ? error.name : "unknown" });
      return json({ error: "CSVを取り込めませんでした", code: "import_failed" }, 500);
    }
  };
}
