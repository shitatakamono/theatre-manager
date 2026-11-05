import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINE_LOGIN_FRIENDSHIP_ENDPOINT,
  LINE_LOGIN_TOKEN_ENDPOINT,
  LINE_LOGIN_VERIFY_ENDPOINT,
} from "../lib/line-login.ts";
import {
  exchangeLineLoginCode,
  getLineFriendshipStatus,
  verifyLineLoginIdToken,
} from "../lib/server/line-login-client.ts";

const lineUserId = `U${"a".repeat(32)}`;

describe("LINE Login API client", () => {
  it("exchanges a code with the server-fixed redirect and PKCE verifier", async () => {
    let captured;
    const result = await exchangeLineLoginCode({
      code: "authorization-code",
      redirectUri: "https://app.example/api/line/login/callback",
      channelId: "channel-a",
      channelSecret: "secret-a",
      codeVerifier: "verifier-a",
      fetchImpl: async (url, init) => {
        captured = { url, init };
        return Response.json({ access_token: "access-a", id_token: "id-a" });
      },
    });
    strictEqual(captured.url, LINE_LOGIN_TOKEN_ENDPOINT);
    const form = new URLSearchParams(captured.init.body);
    strictEqual(form.get("code_verifier"), "verifier-a");
    strictEqual(form.get("redirect_uri"), "https://app.example/api/line/login/callback");
    strictEqual(result.idToken, "id-a");
  });

  it("uses LINE's verification endpoint and accepts only validated claims", async () => {
    let endpoint;
    const result = await verifyLineLoginIdToken({
      idToken: "id-token",
      channelId: "channel-a",
      nonce: "nonce-a",
      nowSeconds: 1_000,
      fetchImpl: async (url) => {
        endpoint = url;
        return Response.json({
          iss: "https://access.line.me",
          sub: lineUserId,
          aud: "channel-a",
          exp: 2_000,
          iat: 900,
          nonce: "nonce-a",
        });
      },
    });
    strictEqual(endpoint, LINE_LOGIN_VERIFY_ENDPOINT);
    strictEqual(result.lineUserId, lineUserId);
  });

  it("reads friendship status and safely rejects malformed/non-2xx responses", async () => {
    let endpoint;
    strictEqual(await getLineFriendshipStatus({
      accessToken: "access-a",
      fetchImpl: async (url) => { endpoint = url; return Response.json({ friendFlag: true }); },
    }), true);
    strictEqual(endpoint, LINE_LOGIN_FRIENDSHIP_ENDPOINT);
    await Promise.all([
      getLineFriendshipStatus({ accessToken: "x", fetchImpl: async () => new Response("", { status: 500 }) }).then(() => { throw new Error("expected failure"); }, (error) => strictEqual(error.code, "friendship_check_failed")),
      exchangeLineLoginCode({ code: "x", redirectUri: "https://app.example/cb", channelId: "x", channelSecret: "x", codeVerifier: "x", fetchImpl: async () => Response.json({}, { status: 200 }) }).then(() => { throw new Error("expected failure"); }, (error) => strictEqual(error.code, "invalid_token_response")),
      verifyLineLoginIdToken({ idToken: "x", channelId: "x", nonce: "x", fetchImpl: async () => new Response("", { status: 400 }) }).then(() => { throw new Error("expected failure"); }, (error) => strictEqual(error.code, "id_token_verification_failed")),
    ]);
  });
});
