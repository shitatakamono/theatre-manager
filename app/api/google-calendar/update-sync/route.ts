import { adminAuth } from "@/lib/server/firebase-admin";
import { GoogleCalendarAccessTokenError } from "@/lib/server/google-calendar-access-token";
import { GoogleCalendarSyncPreviewError } from "@/lib/server/google-calendar-sync-preview";
import {
  GoogleCalendarUpdateSyncError,
  runGoogleCalendarUpdateSync,
} from "@/lib/server/google-calendar-update-sync";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function validProjectId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && !value.includes("/");
}

export async function POST(request: Request): Promise<Response> {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "ログインが必要です", code: "unauthenticated" }, 401);

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(match[1])).uid;
  } catch {
    return json({ error: "認証情報を確認できませんでした", code: "invalid_authentication" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "公演情報を確認してください", code: "invalid_request" }, 400);
  }
  const projectId = body && typeof body === "object" && "projectId" in body
    ? body.projectId
    : null;
  if (!validProjectId(projectId)) {
    return json({ error: "公演情報を確認してください", code: "invalid_project_id" }, 400);
  }

  try {
    return json(await runGoogleCalendarUpdateSync(uid, projectId), 200);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      && typeof error.code === "string" ? error.code : null;
    const status = error && typeof error === "object" && "providerStatus" in error
      && typeof error.providerStatus === "number" ? error.providerStatus : null;
    console.error("google_calendar_update_sync_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code,
      status,
    });

    if (error instanceof GoogleCalendarSyncPreviewError) {
      return json(
        { error: "同期対象の稽古情報を確認できませんでした", code: error.code },
        error.status
      );
    }
    if (error instanceof GoogleCalendarAccessTokenError) {
      return json(
        { error: "Googleカレンダーの連携状態を確認できませんでした", code: error.code },
        error.code === "not_connected" ? 409 : 502
      );
    }
    if (error instanceof GoogleCalendarUpdateSyncError) {
      return json(
        { error: "SeisakuBoardカレンダーを確認できませんでした", code: error.code },
        error.status
      );
    }
    return json(
      { error: "Googleカレンダーの更新同期に失敗しました", code: "update_sync_failed" },
      500
    );
  }
}
