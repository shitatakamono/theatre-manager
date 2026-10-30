import { adminAuth } from "@/lib/server/firebase-admin";
import {
  GoogleCalendarAccessTokenError,
} from "@/lib/server/google-calendar-access-token";
import {
  GoogleCalendarEnsureError,
} from "@/lib/server/google-calendar-calendar";
import {
  GoogleCalendarInitialSyncError,
  runGoogleCalendarInitialSync,
} from "@/lib/server/google-calendar-initial-sync";
import {
  GoogleCalendarSyncPreviewError,
} from "@/lib/server/google-calendar-sync-preview";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    && typeof error.code === "string"
    ? error.code
    : null;
}

function validProjectId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && !value.includes("/");
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return json({ error: "ログインが必要です", code: "unauthenticated" }, 401);
  }

  let uid: string;
  try {
    uid = (await adminAuth.verifyIdToken(match[1])).uid;
  } catch {
    return json(
      { error: "認証情報を確認できませんでした", code: "invalid_authentication" },
      401
    );
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
    return json(await runGoogleCalendarInitialSync(uid, projectId), 200);
  } catch (error) {
    const code = errorCode(error);
    const providerStatus = error && typeof error === "object"
      && "providerStatus" in error && typeof error.providerStatus === "number"
      ? error.providerStatus
      : null;
    console.error("google_calendar_initial_sync_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code,
      status: providerStatus,
    });

    if (error instanceof GoogleCalendarInitialSyncError) {
      return json(
        { error: "このシステム利用者は関係者と連携されていません", code: error.code },
        error.status
      );
    }
    if (error instanceof GoogleCalendarSyncPreviewError) {
      const message = error.code === "not_member"
        ? "この公演を同期する権限がありません"
        : "同期対象の稽古情報を確認できませんでした";
      return json({ error: message, code: error.code }, error.status);
    }
    if (error instanceof GoogleCalendarAccessTokenError) {
      const status = error.code === "not_connected" ? 409 : 502;
      return json(
        { error: "Googleカレンダーの連携状態を確認できませんでした", code: error.code },
        status
      );
    }
    if (error instanceof GoogleCalendarEnsureError) {
      const status = error.code === "not_connected" ? 409 : 502;
      return json(
        { error: "SeisakuBoardカレンダーを確認できませんでした", code: error.code },
        status
      );
    }
    return json(
      { error: "Googleカレンダーへの初回同期に失敗しました", code: "initial_sync_failed" },
      500
    );
  }
}
