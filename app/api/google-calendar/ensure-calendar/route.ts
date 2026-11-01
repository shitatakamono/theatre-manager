import { adminAuth } from "@/lib/server/firebase-admin";
import {
  ensureGoogleCalendar,
  GoogleCalendarEnsureError,
} from "@/lib/server/google-calendar-calendar";
import { GoogleCalendarAccessTokenError } from "@/lib/server/google-calendar-access-token";

export const runtime = "nodejs";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function safeErrorMetadata(error: unknown): {
  name: string;
  code: string | null;
  status: number | null;
} {
  return {
    name: error instanceof Error ? error.name : "UnknownError",
    code:
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : null,
    status:
      error instanceof GoogleCalendarEnsureError ||
      error instanceof GoogleCalendarAccessTokenError
        ? error.providerStatus
        : null,
  };
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return json({ error: "ログインが必要です", code: "unauthenticated" }, 401);
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    uid = decoded.uid;
  } catch {
    return json(
      {
        error: "認証情報を確認できませんでした",
        code: "invalid_authentication",
      },
      401
    );
  }

  try {
    const result = await ensureGoogleCalendar(uid);

    return json(
      {
        success: true,
        created: result.created,
      },
      200
    );
  } catch (error) {
    console.error(
      "google_calendar_ensure_calendar_failed",
      safeErrorMetadata(error)
    );

    if (
      (error instanceof GoogleCalendarEnsureError &&
        error.code === "not_connected") ||
      (error instanceof GoogleCalendarAccessTokenError &&
        error.code === "not_connected")
    ) {
      return json(
        {
          error: "Googleカレンダーが連携されていません",
          code: "google_calendar_not_connected",
        },
        409
      );
    }

    if (
      error instanceof GoogleCalendarAccessTokenError &&
      error.code === "server_configuration"
    ) {
      return json(
        {
          error: "Googleカレンダー連携の設定が不足しています",
          code: "server_configuration",
        },
        500
      );
    }

    if (
      error instanceof GoogleCalendarEnsureError &&
      error.code === "calendar_provisioning_in_progress"
    ) {
      return json(
        {
          error: "SeisakuBoard専用カレンダーを作成しています。少し待ってからもう一度お試しください",
          code: "calendar_provisioning_in_progress",
        },
        409
      );
    }

    if (
      error instanceof GoogleCalendarEnsureError &&
      (error.code === "connection_lookup_failed" ||
        error.code === "connection_save_failed")
    ) {
      return json(
        {
          error: "Googleカレンダー接続情報を更新できませんでした",
          code: "connection_update_failed",
        },
        500
      );
    }

    if (
      error instanceof GoogleCalendarEnsureError &&
      error.code === "calendar_lookup_failed"
    ) {
      return json(
        {
          error: "SeisakuBoard専用カレンダーを確認できませんでした",
          code: "calendar_lookup_failed",
        },
        502
      );
    }

    if (error instanceof GoogleCalendarAccessTokenError) {
      return json(
        {
          error: "Googleカレンダーの認証情報を更新できませんでした",
          code: "access_token_failed",
        },
        502
      );
    }

    if (error instanceof GoogleCalendarEnsureError) {
      return json(
        {
          error: "SeisakuBoard専用カレンダーを作成できませんでした",
          code: "calendar_creation_failed",
        },
        502
      );
    }

    return json(
      {
        error: "SeisakuBoard専用カレンダーを確保できませんでした",
        code: "calendar_setup_failed",
      },
      500
    );
  }
}
