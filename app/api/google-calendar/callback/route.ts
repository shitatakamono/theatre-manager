import { NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { adminDb } from "@/lib/server/firebase-admin";
import {
  consumeGoogleCalendarOAuthState,
} from "@/lib/server/google-calendar-oauth-state";
import {
  encryptGoogleCalendarToken,
} from "@/lib/server/google-calendar-crypto";

export const runtime = "nodejs";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CONNECTIONS_COLLECTION = "googleCalendarConnections";

function safeErrorMetadata(error: unknown): {
  name: string;
  code: string | null;
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
  };
}

function getRedirectUri(): string {
  const explicit = process.env.GOOGLE_CALENDAR_REDIRECT_URI;
  if (explicit) return explicit;

  if (process.env.VERCEL_ENV === "production") {
    return "https://theatre-manager-iota.vercel.app/api/google-calendar/callback";
  }

  return "http://localhost:3000/api/google-calendar/callback";
}

function settingsUrl(request: Request, status: string): URL {
  const origin =
    process.env.VERCEL_ENV === "production"
      ? "https://theatre-manager-iota.vercel.app"
      : new URL(request.url).origin;

  const url = new URL("/settings", origin);
  url.searchParams.set("googleCalendar", status);

  return url;
}

export async function GET(request: Request): Promise<Response> {
  const requestUrl = new URL(request.url);

  const error = requestUrl.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      settingsUrl(request, "cancelled")
    );
  }

  const code = requestUrl.searchParams.get("code") ?? "";
  const state = requestUrl.searchParams.get("state") ?? "";

  if (!code || !state) {
    return NextResponse.redirect(
      settingsUrl(request, "invalid_callback")
    );
  }

  let uid: string | null = null;

  try {
    uid = await consumeGoogleCalendarOAuthState(state);
  } catch (error) {
    console.error(
      "Google Calendar OAuth state確認エラー:",
      safeErrorMetadata(error)
    );
  }

  if (!uid) {
    return NextResponse.redirect(
      settingsUrl(request, "invalid_state")
    );
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Google Calendar OAuth環境変数が不足しています");
    return NextResponse.redirect(
      settingsUrl(request, "server_configuration")
    );
  }

  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(),
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Google Calendar token交換エラー:", {
        status: tokenResponse.status,
      });

      return NextResponse.redirect(
        settingsUrl(request, "token_exchange_failed")
      );
    }

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      expires_in?: number;
      refresh_token?: string;
      scope?: string;
      token_type?: string;
    };

    if (!tokenData.refresh_token) {
      console.error(
        "Google Calendar refresh tokenが返されませんでした"
      );

      return NextResponse.redirect(
        settingsUrl(request, "missing_refresh_token")
      );
    }

    const encryptedRefreshToken = encryptGoogleCalendarToken(
      tokenData.refresh_token
    );

    const now = Timestamp.now();
    const connectionRef = adminDb
      .collection(CONNECTIONS_COLLECTION)
      .doc(uid);

    await adminDb.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(connectionRef);

      transaction.set(
        connectionRef,
        {
          connected: true,
          refreshToken: encryptedRefreshToken,
          scope: tokenData.scope ?? "",
          ...(snapshot.exists ? {} : { createdAt: now }),
          updatedAt: now,
        },
        { merge: true }
      );
    });

    return NextResponse.redirect(
      settingsUrl(request, "connected")
    );
  } catch (error) {
    console.error(
      "Google Calendar callback処理エラー:",
      safeErrorMetadata(error)
    );

    return NextResponse.redirect(
      settingsUrl(request, "failed")
    );
  }
}
