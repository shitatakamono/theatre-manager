import { adminAuth } from "@/lib/server/firebase-admin";
import {
  getGoogleCalendarSyncPreview,
  GoogleCalendarSyncPreviewError,
} from "@/lib/server/google-calendar-sync-preview";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function validProjectId(value: string): boolean {
  return value.length > 0 && value.length <= 128 && !value.includes("/");
}

export async function GET(request: Request): Promise<Response> {
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

  const projectId = new URL(request.url).searchParams.get("projectId")?.trim() ?? "";
  if (!validProjectId(projectId)) {
    return json({ error: "公演情報を確認してください", code: "invalid_project_id" }, 400);
  }

  try {
    const preview = await getGoogleCalendarSyncPreview(uid, projectId);
    return json({ success: true, ...preview }, 200);
  } catch (error) {
    console.error("google_calendar_sync_preview_failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code: error instanceof GoogleCalendarSyncPreviewError ? error.code : null,
    });

    if (error instanceof GoogleCalendarSyncPreviewError) {
      const messages: Record<GoogleCalendarSyncPreviewError["code"], string> = {
        not_member: "この公演の同期プレビューを確認する権限がありません",
        project_not_found: "公演情報が見つかりません",
        linked_person_not_found: "連携された関係者情報が見つかりません",
        invalid_sync_data: "同期対象の稽古情報を確認できませんでした",
        preview_read_failed: "同期プレビューを作成できませんでした",
      };
      return json({ error: messages[error.code], code: error.code }, error.status);
    }

    return json(
      { error: "同期プレビューを作成できませんでした", code: "preview_failed" },
      500
    );
  }
}
