import { createGoogleCalendarOAuthState } from "@/lib/server/google-calendar-oauth-state";
import { adminAuth } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function getRedirectUri(): string {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (explicit) return explicit;

  if (process.env.VERCEL_ENV === "production") {
    return "https://theatre-manager-iota.vercel.app/api/google-calendar/callback";
  }

  return "http://localhost:3000/api/google-calendar/callback";
}

export async function POST(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return json({ error: "ログインが必要です" }, 401);
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(match[1]);
    uid = decoded.uid;
  } catch {
    return json({ error: "認証情報を確認できませんでした" }, 401);
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  if (!clientId) {
    console.error("GOOGLE_CALENDAR_CLIENT_ID が設定されていません");
    return json({ error: "Googleカレンダー連携の設定が不足しています" }, 500);
  }

  try {
    const state = await createGoogleCalendarOAuthState(uid);

    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", getRedirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_CALENDAR_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    return json({ authorizationUrl: url.toString() }, 200);
  } catch (error) {
    console.error("Google Calendar OAuth開始エラー:", error);
    return json(
      { error: "Googleカレンダー連携を開始できませんでした" },
      500
    );
  }
}
