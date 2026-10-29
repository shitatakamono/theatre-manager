import "server-only";

import { adminDb } from "@/lib/server/firebase-admin";
import {
  decryptGoogleCalendarToken,
  type EncryptedGoogleCalendarToken,
} from "@/lib/server/google-calendar-crypto";

const CONNECTIONS_COLLECTION = "googleCalendarConnections";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export type GoogleCalendarAccessTokenErrorCode =
  | "not_connected"
  | "server_configuration"
  | "refresh_token_invalid"
  | "refresh_token_decryption_failed"
  | "access_token_request_failed"
  | "access_token_response_invalid";

export class GoogleCalendarAccessTokenError extends Error {
  readonly code: GoogleCalendarAccessTokenErrorCode;
  readonly providerStatus: number | null;

  constructor(
    code: GoogleCalendarAccessTokenErrorCode,
    providerStatus: number | null = null
  ) {
    super(code);
    this.name = "GoogleCalendarAccessTokenError";
    this.code = code;
    this.providerStatus = providerStatus;
  }
}

function isEncryptedToken(
  value: unknown
): value is EncryptedGoogleCalendarToken {
  if (!value || typeof value !== "object") return false;

  const token = value as Partial<EncryptedGoogleCalendarToken>;

  return (
    typeof token.ciphertext === "string" &&
    typeof token.iv === "string" &&
    typeof token.authTag === "string"
  );
}

export async function getGoogleCalendarAccessToken(
  uid: string
): Promise<string> {
  const snapshot = await adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid)
    .get();

  if (!snapshot.exists || snapshot.data()?.connected !== true) {
    throw new GoogleCalendarAccessTokenError("not_connected");
  }

  const encryptedToken = snapshot.data()?.refreshToken;

  if (!isEncryptedToken(encryptedToken)) {
    throw new GoogleCalendarAccessTokenError("refresh_token_invalid");
  }

  let refreshToken: string;
  try {
    refreshToken = decryptGoogleCalendarToken(encryptedToken);
  } catch {
    throw new GoogleCalendarAccessTokenError(
      "refresh_token_decryption_failed"
    );
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new GoogleCalendarAccessTokenError("server_configuration");
  }

  let tokenResponse: Response;
  try {
    tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });
  } catch {
    throw new GoogleCalendarAccessTokenError(
      "access_token_request_failed"
    );
  }

  if (!tokenResponse.ok) {
    throw new GoogleCalendarAccessTokenError(
      "access_token_request_failed",
      tokenResponse.status
    );
  }

  let tokenData: unknown;
  try {
    tokenData = await tokenResponse.json();
  } catch {
    throw new GoogleCalendarAccessTokenError(
      "access_token_response_invalid",
      tokenResponse.status
    );
  }

  const accessToken =
    tokenData &&
    typeof tokenData === "object" &&
    "access_token" in tokenData &&
    typeof tokenData.access_token === "string"
      ? tokenData.access_token
      : "";

  if (!accessToken) {
    throw new GoogleCalendarAccessTokenError(
      "access_token_response_invalid",
      tokenResponse.status
    );
  }

  return accessToken;
}
