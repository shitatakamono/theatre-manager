import { adminAuth, adminDb } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

const CONNECTIONS_COLLECTION = "googleCalendarConnections";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function GET(request: Request): Promise<Response> {
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

  try {
    const snapshot = await adminDb
      .collection(CONNECTIONS_COLLECTION)
      .doc(uid)
      .get();

    if (!snapshot.exists) {
      return json({ connected: false }, 200);
    }

    const data = snapshot.data();

    return json(
      {
        connected: data?.connected === true,
      },
      200
    );
  } catch (error) {
    console.error("Google Calendar連携状態確認エラー:", error);

    return json(
      { error: "Googleカレンダーの連携状態を確認できませんでした" },
      500
    );
  }
}