import { adminAuth, adminDb } from "@/lib/server/firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  decryptGoogleCalendarToken,
  type EncryptedGoogleCalendarToken,
} from "@/lib/server/google-calendar-crypto";

export const runtime = "nodejs";

const CONNECTIONS_COLLECTION = "googleCalendarConnections";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
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

  const ref = adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid);

  try {
    const snapshot = await ref.get();

    if (!snapshot.exists) {
      return json({ success: true, connected: false }, 200);
    }

    const data = snapshot.data();
    const encryptedToken = data?.refreshToken as
      | EncryptedGoogleCalendarToken
      | undefined;

    if (encryptedToken) {
      const refreshToken =
        decryptGoogleCalendarToken(encryptedToken);

      const revokeResponse = await fetch(GOOGLE_REVOKE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: refreshToken,
        }),
      });

      if (!revokeResponse.ok) {
        if (
          revokeResponse.status === 400 ||
          revokeResponse.status === 401
        ) {
          console.warn("Google Calendar認可はすでに無効です:", {
            status: revokeResponse.status,
          });
        } else {
          console.error("Google Calendar認可解除エラー:", {
            status: revokeResponse.status,
          });

          return json(
            {
              error:
                "Googleカレンダーとの連携を解除できませんでした",
            },
            502
          );
        }
      }
    }

    await ref.update({
      connected: false,
      refreshToken: FieldValue.delete(),
      calendarProvisioning: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });

    return json(
      {
        success: true,
        connected: false,
      },
      200
    );
  } catch (error) {
    console.error("Google Calendar連携解除処理エラー:", {
      name: error instanceof Error ? error.name : "UnknownError",
      code:
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : null,
    });

    return json(
      {
        error:
          "Googleカレンダーとの連携を解除できませんでした",
      },
      500
    );
  }
}
