import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINE_ACCOUNT_LINK_DIALOG_URL,
  buildLineAccountLinkRedirectUrl,
} from "../lib/line-account-link-authorize.ts";
import { createLineAccountLinkAuthorizeHandler } from "../lib/server/line-account-link-authorize-handler.ts";

function request(body, token = "firebase-token") {
  return new Request("https://example.test/api/line/account-link/authorize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides = {}) {
  return {
    verifyIdToken: async () => ({ uid: "firebase-uid" }),
    createNonce: async () => "valid_nonce_1234567890",
    logError: () => undefined,
    ...overrides,
  };
}

describe("LINE account-link authorize API", () => {
  it("requires a valid Firebase ID token", async () => {
    const handler = createLineAccountLinkAuthorizeHandler(dependencies());
    strictEqual((await handler(new Request("https://example.test", { method: "POST" }))).status, 401);
    const invalid = createLineAccountLinkAuthorizeHandler(dependencies({
      verifyIdToken: async () => { throw new Error("invalid"); },
    }));
    strictEqual((await invalid(request({ linkToken: "valid_link_token_123456" }))).status, 401);
  });

  it("rejects a missing or malformed link token before creating a nonce", async () => {
    let created = false;
    const handler = createLineAccountLinkAuthorizeHandler(dependencies({
      createNonce: async () => { created = true; return "valid_nonce_1234567890"; },
    }));
    const response = await handler(request({}));
    strictEqual(response.status, 400);
    strictEqual(created, false);
  });

  it("creates a nonce for the verified uid and returns only the fixed LINE redirect", async () => {
    const calls = [];
    const handler = createLineAccountLinkAuthorizeHandler(dependencies({
      createNonce: async (uid) => { calls.push(uid); return "valid_nonce_1234567890"; },
    }));
    const response = await handler(request({ linkToken: "valid_link_token_123456" }));
    strictEqual(response.status, 200);
    const body = await response.json();
    const redirect = new URL(body.redirectUrl);
    deepStrictEqual(calls, ["firebase-uid"]);
    strictEqual(redirect.origin, "https://access.line.me");
    strictEqual(`${redirect.origin}${redirect.pathname}`, LINE_ACCOUNT_LINK_DIALOG_URL);
    strictEqual(redirect.searchParams.get("linkToken"), "valid_link_token_123456");
    strictEqual(redirect.searchParams.get("nonce"), "valid_nonce_1234567890");
    strictEqual(response.headers.get("cache-control"), "no-store");
  });

  it("does not accept a client-provided redirect URL", () => {
    const redirect = new URL(buildLineAccountLinkRedirectUrl({
      linkToken: "valid_link_token_123456",
      nonce: "valid_nonce_1234567890",
      redirectUrl: "https://evil.example",
    }));
    strictEqual(redirect.origin, "https://access.line.me");
  });
});
