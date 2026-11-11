import { randomBytes } from "node:crypto";

import { sha256Base64Url } from "./line-account-link.ts";

export const LINE_LOGIN_STATE_TTL_MS = 10 * 60 * 1000;
export const LINE_LOGIN_AUTHORIZE_ENDPOINT = "https://access.line.me/oauth2/v2.1/authorize";
export const LINE_LOGIN_TOKEN_ENDPOINT = "https://api.line.me/oauth2/v2.1/token";
export const LINE_LOGIN_VERIFY_ENDPOINT = "https://api.line.me/oauth2/v2.1/verify";
export const LINE_LOGIN_FRIENDSHIP_ENDPOINT = "https://api.line.me/friendship/v1/status";
export const LINE_LOGIN_ISSUER = "https://access.line.me";

export type LineLoginStateStatus = "pending" | "consumed" | "failed";

export type LineLoginState = {
  uid: string;
  nonce: string;
  codeVerifier: string;
  status: LineLoginStateStatus;
  createdAt: unknown;
  expiresAt: unknown;
  consumedAt: unknown | null;
};

export type VerifiedLineIdToken = {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce: string;
  name?: string;
  picture?: string;
};

export class LineLoginError extends Error {
  readonly code: string;

  constructor(code: string) {
    super("LINE連携を完了できませんでした");
    this.name = "LineLoginError";
    this.code = code;
  }
}

function randomBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function generateLineLoginState(): string {
  return randomBase64Url();
}

export function generateLineLoginNonce(): string {
  return randomBase64Url();
}

export function generateLineLoginCodeVerifier(): string {
  return randomBase64Url();
}

export function getLineLoginStateId(state: string): string {
  if (!/^[A-Za-z0-9_-]{43,255}$/.test(state)) {
    throw new LineLoginError("invalid_state");
  }
  return sha256Base64Url(state);
}

export function createLineLoginCodeChallenge(codeVerifier: string): string {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)) {
    throw new LineLoginError("invalid_code_verifier");
  }
  return sha256Base64Url(codeVerifier);
}

export function buildLineLoginAuthorizationUrl(input: {
  channelId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  if (!input.channelId.trim()) throw new LineLoginError("missing_configuration");
  const redirect = new URL(input.redirectUri);
  if (redirect.protocol !== "https:" && redirect.hostname !== "localhost") {
    throw new LineLoginError("invalid_redirect_uri");
  }
  const url = new URL(LINE_LOGIN_AUTHORIZE_ENDPOINT);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.channelId);
  url.searchParams.set("redirect_uri", redirect.toString());
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("bot_prompt", "normal");
  return url.toString();
}

export function validateVerifiedLineIdToken(input: {
  claims: Record<string, unknown>;
  channelId: string;
  nonce: string;
  nowSeconds?: number;
}): VerifiedLineIdToken {
  const { claims } = input;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const iss = typeof claims.iss === "string" ? claims.iss : "";
  const sub = typeof claims.sub === "string" ? claims.sub : "";
  const aud = typeof claims.aud === "string" ? claims.aud : "";
  const nonce = typeof claims.nonce === "string" ? claims.nonce : "";
  const exp = typeof claims.exp === "number" ? claims.exp : Number.NaN;
  const iat = typeof claims.iat === "number" ? claims.iat : Number.NaN;

  if (iss !== LINE_LOGIN_ISSUER) throw new LineLoginError("invalid_id_token_issuer");
  if (aud !== input.channelId) throw new LineLoginError("invalid_id_token_audience");
  if (nonce !== input.nonce) throw new LineLoginError("invalid_id_token_nonce");
  if (!sub) throw new LineLoginError("invalid_id_token_subject");
  if (!Number.isFinite(exp) || exp <= now) throw new LineLoginError("expired_id_token");
  if (!Number.isFinite(iat) || iat > now + 60) throw new LineLoginError("invalid_id_token_issued_at");

  const name = typeof claims.name === "string" && claims.name.trim()
    ? claims.name.trim().slice(0, 128)
    : undefined;
  let picture: string | undefined;
  if (typeof claims.picture === "string") {
    try {
      const url = new URL(claims.picture);
      if (url.protocol === "https:") picture = url.toString();
    } catch {
      // Ignore an invalid optional profile image.
    }
  }
  return { iss, sub, aud, exp, iat, nonce, ...(name ? { name } : {}), ...(picture ? { picture } : {}) };
}
