import { notStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINE_LOGIN_AUTHORIZE_ENDPOINT,
  LineLoginError,
  buildLineLoginAuthorizationUrl,
  createLineLoginCodeChallenge,
  generateLineLoginCodeVerifier,
  generateLineLoginNonce,
  generateLineLoginState,
  getLineLoginStateId,
  validateVerifiedLineIdToken,
} from "../lib/line-login.ts";
import { getLineAuthRedirectUri, getLineLoginRedirectUri } from "../lib/app-url.ts";

describe("LINE Login primitives", () => {
  it("generates opaque state, nonce, verifier, and a deterministic hashed state ID", () => {
    const stateA = generateLineLoginState();
    const stateB = generateLineLoginState();
    const nonce = generateLineLoginNonce();
    const verifier = generateLineLoginCodeVerifier();
    strictEqual(stateA.length, 43);
    strictEqual(nonce.length, 43);
    strictEqual(verifier.length, 43);
    notStrictEqual(stateA, stateB);
    strictEqual(getLineLoginStateId(stateA), getLineLoginStateId(stateA));
    notStrictEqual(getLineLoginStateId(stateA), stateA);
    strictEqual(createLineLoginCodeChallenge(verifier).length, 43);
  });

  it("builds the fixed v2.1 authorization request with OIDC, PKCE, and bot prompt", () => {
    const url = new URL(buildLineLoginAuthorizationUrl({
      channelId: "line-login-channel",
      redirectUri: "https://seisakuboard.example/api/line/login/callback",
      state: generateLineLoginState(),
      nonce: generateLineLoginNonce(),
      codeChallenge: createLineLoginCodeChallenge(generateLineLoginCodeVerifier()),
    }));
    strictEqual(`${url.origin}${url.pathname}`, LINE_LOGIN_AUTHORIZE_ENDPOINT);
    strictEqual(url.searchParams.get("response_type"), "code");
    strictEqual(url.searchParams.get("client_id"), "line-login-channel");
    strictEqual(url.searchParams.get("redirect_uri"), "https://seisakuboard.example/api/line/login/callback");
    strictEqual(url.searchParams.get("scope"), "openid profile");
    strictEqual(url.searchParams.get("code_challenge_method"), "S256");
    strictEqual(url.searchParams.get("bot_prompt"), "normal");
  });

  it("builds the callback only from the configured application origin", () => {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    try {
      process.env.NEXT_PUBLIC_APP_URL = "https://seisakuboard.example/untrusted-path";
      strictEqual(getLineLoginRedirectUri(), "https://seisakuboard.example/api/line/login/callback");
      strictEqual(getLineAuthRedirectUri(), "https://seisakuboard.example/api/line/auth/callback");
      delete process.env.NEXT_PUBLIC_APP_URL;
      throws(() => getLineLoginRedirectUri(), /NEXT_PUBLIC_APP_URL/);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });

  it("validates all security-relevant verified ID token claims", () => {
    const claims = {
      iss: "https://access.line.me",
      sub: `U${"a".repeat(32)}`,
      aud: "channel-a",
      exp: 2_000,
      iat: 900,
      nonce: "nonce-a",
    };
    strictEqual(validateVerifiedLineIdToken({ claims, channelId: "channel-a", nonce: "nonce-a", nowSeconds: 1_000 }).sub, claims.sub);
    for (const [property, value, code] of [
      ["iss", "https://evil.example", "invalid_id_token_issuer"],
      ["aud", "other", "invalid_id_token_audience"],
      ["nonce", "other", "invalid_id_token_nonce"],
      ["sub", "", "invalid_id_token_subject"],
      ["exp", 999, "expired_id_token"],
      ["iat", 1_061, "invalid_id_token_issued_at"],
    ]) {
      throws(
        () => validateVerifiedLineIdToken({ claims: { ...claims, [property]: value }, channelId: "channel-a", nonce: "nonce-a", nowSeconds: 1_000 }),
        (error) => error instanceof LineLoginError && error.code === code
      );
    }
  });
});
