import {
  LINE_LOGIN_FRIENDSHIP_ENDPOINT,
  LINE_LOGIN_TOKEN_ENDPOINT,
  LINE_LOGIN_VERIFY_ENDPOINT,
  LineLoginError,
  validateVerifiedLineIdToken,
} from "../line-login.ts";
import { requireLineUserId } from "../line-account-link.ts";

type FetchInput = typeof fetch;

async function postForm(
  endpoint: string,
  values: Record<string, string>,
  fetchImpl: FetchInput
): Promise<Response> {
  try {
    return await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(values),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LineLoginError("line_network_error");
  }
}

export async function exchangeLineLoginCode(input: {
  code: string;
  redirectUri: string;
  channelId: string;
  channelSecret: string;
  codeVerifier: string;
  fetchImpl?: FetchInput;
}): Promise<{ accessToken: string; idToken: string }> {
  const response = await postForm(LINE_LOGIN_TOKEN_ENDPOINT, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.channelId,
    client_secret: input.channelSecret,
    code_verifier: input.codeVerifier,
  }, input.fetchImpl ?? fetch);
  if (!response.ok) throw new LineLoginError("token_exchange_failed");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LineLoginError("invalid_token_response");
  }
  const accessToken = body && typeof body === "object"
    ? (body as { access_token?: unknown }).access_token
    : null;
  const idToken = body && typeof body === "object"
    ? (body as { id_token?: unknown }).id_token
    : null;
  if (typeof accessToken !== "string" || !accessToken
    || typeof idToken !== "string" || !idToken) {
    throw new LineLoginError("invalid_token_response");
  }
  return { accessToken, idToken };
}

export async function verifyLineLoginIdToken(input: {
  idToken: string;
  channelId: string;
  nonce: string;
  fetchImpl?: FetchInput;
  nowSeconds?: number;
}): Promise<{ lineUserId: string; displayName?: string; photoURL?: string }> {
  const response = await postForm(LINE_LOGIN_VERIFY_ENDPOINT, {
    id_token: input.idToken,
    client_id: input.channelId,
    nonce: input.nonce,
  }, input.fetchImpl ?? fetch);
  if (!response.ok) throw new LineLoginError("id_token_verification_failed");
  let claims: unknown;
  try {
    claims = await response.json();
  } catch {
    throw new LineLoginError("invalid_id_token_response");
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new LineLoginError("invalid_id_token_response");
  }
  const verified = validateVerifiedLineIdToken({
    claims: claims as Record<string, unknown>,
    channelId: input.channelId,
    nonce: input.nonce,
    nowSeconds: input.nowSeconds,
  });
  return {
    lineUserId: requireLineUserId(verified.sub),
    ...(verified.name ? { displayName: verified.name } : {}),
    ...(verified.picture ? { photoURL: verified.picture } : {}),
  };
}

export async function getLineFriendshipStatus(input: {
  accessToken: string;
  fetchImpl?: FetchInput;
}): Promise<boolean> {
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(LINE_LOGIN_FRIENDSHIP_ENDPOINT, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LineLoginError("friendship_network_error");
  }
  if (!response.ok) throw new LineLoginError("friendship_check_failed");
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LineLoginError("friendship_invalid_response");
  }
  if (!body || typeof body !== "object" || typeof (body as { friendFlag?: unknown }).friendFlag !== "boolean") {
    throw new LineLoginError("friendship_invalid_response");
  }
  return (body as { friendFlag: boolean }).friendFlag;
}
