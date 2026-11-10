import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createLineAuthCallbackHandler,
  createLineAuthExchangeHandler,
  createLineAuthStartHandler,
} from "../lib/server/line-auth-handler.ts";

const state = "s".repeat(43);
const ticket = "t".repeat(43);
const verifier = "v".repeat(43);
const lineUserId = `U${"a".repeat(32)}`;

function callbackDependencies(overrides = {}) {
  return {
    readState: async () => ({ status: "pending", nonce: "nonce-a", codeVerifier: verifier }),
    failState: async () => undefined,
    exchangeCode: async () => ({ accessToken: "access-a", idToken: "id-a" }),
    verifyIdToken: async () => ({ lineUserId }),
    completeState: async () => ({ outcome: "ticket_created", ticket }),
    getConfig: () => ({
      appOrigin: "https://app.example",
      channelId: "channel-a",
      channelSecret: "secret-a",
      redirectUri: "https://app.example/api/line/auth/callback",
    }),
    logError: () => undefined,
    ...overrides,
  };
}

describe("LINE authentication start", () => {
  it("creates an unauthenticated OIDC/PKCE request using the separate callback", async () => {
    const handler = createLineAuthStartHandler({
      createState: async () => ({ state, nonce: "nonce-a", codeVerifier: verifier }),
      getConfig: () => ({ channelId: "channel-a", redirectUri: "https://app.example/api/line/auth/callback" }),
    });
    const response = await handler();
    const body = await response.json();
    const redirect = new URL(body.redirectUrl);
    strictEqual(redirect.origin, "https://access.line.me");
    strictEqual(redirect.searchParams.get("state"), state);
    strictEqual(redirect.searchParams.get("nonce"), "nonce-a");
    strictEqual(redirect.searchParams.get("code_challenge_method"), "S256");
    strictEqual(redirect.searchParams.get("redirect_uri"), "https://app.example/api/line/auth/callback");
  });
});

describe("LINE authentication callback", () => {
  it("uses only the verified LINE identity and returns an opaque ticket", async () => {
    const calls = [];
    const handler = createLineAuthCallbackHandler(callbackDependencies({
      verifyIdToken: async (input) => { calls.push(["verify", input]); return { lineUserId }; },
      completeState: async (input) => { calls.push(["complete", input]); return { outcome: "ticket_created", ticket }; },
    }));
    const response = await handler(new Request(`https://evil.example/api/line/auth/callback?code=code-a&state=${state}&uid=attacker&lineUserId=attacker`));
    strictEqual(response.status, 303);
    const location = new URL(response.headers.get("location"));
    strictEqual(location.origin, "https://app.example");
    strictEqual(location.pathname, "/line/auth/complete");
    strictEqual(location.searchParams.has("ticket"), false);
    strictEqual(new URLSearchParams(location.hash.slice(1)).get("ticket"), ticket);
    deepStrictEqual(calls[1][1], { state, lineUserId });
  });

  it("does not issue a ticket for an unlinked LINE identity", async () => {
    const handler = createLineAuthCallbackHandler(callbackDependencies({
      completeState: async () => ({ outcome: "not_linked" }),
    }));
    const response = await handler(new Request(`https://app.example/api/line/auth/callback?code=x&state=${state}`));
    const location = new URL(response.headers.get("location"));
    strictEqual(location.searchParams.get("result"), "unlinked");
    strictEqual(location.searchParams.has("ticket"), false);
  });

  it("rejects missing, replayed, cancelled, and invalid-token callbacks safely", async () => {
    const noState = await createLineAuthCallbackHandler(callbackDependencies())(
      new Request("https://app.example/api/line/auth/callback")
    );
    strictEqual(new URL(noState.headers.get("location")).searchParams.get("result"), "error");

    for (const overrides of [
      { readState: async () => ({ status: "consumed", nonce: "", codeVerifier: "" }) },
      { readState: async () => { throw new Error("state mismatch"); } },
      { verifyIdToken: async () => { throw new Error("invalid claims"); } },
    ]) {
      const response = await createLineAuthCallbackHandler(callbackDependencies(overrides))(
        new Request(`https://app.example/api/line/auth/callback?code=x&state=${state}`)
      );
      strictEqual(new URL(response.headers.get("location")).searchParams.get("result"), "error");
    }

    let failed = 0;
    const cancelled = await createLineAuthCallbackHandler(callbackDependencies({
      failState: async () => { failed += 1; },
    }))(new Request(`https://app.example/api/line/auth/callback?error=access_denied&state=${state}`));
    strictEqual(new URL(cancelled.headers.get("location")).searchParams.get("result"), "error");
    strictEqual(failed, 1);
  });
});

describe("LINE authentication ticket exchange", () => {
  it("uses only the ticket-derived uid and returns the custom token once", async () => {
    const calls = [];
    const logs = [];
    const handler = createLineAuthExchangeHandler({
      consumeTicket: async (value) => { calls.push(["consume", value]); return "mapped-firebase-uid"; },
      getUser: async (uid) => { calls.push(["user", uid]); return {}; },
      createCustomToken: async (uid) => { calls.push(["token", uid]); return "firebase-custom-token-secret"; },
      logError: (value) => logs.push(value),
    });
    const response = await handler(new Request("https://app.example/api/line/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, uid: "attacker", lineUserId: "attacker" }),
    }));
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { customToken: "firebase-custom-token-secret" });
    deepStrictEqual(calls, [
      ["consume", ticket],
      ["user", "mapped-firebase-uid"],
      ["token", "mapped-firebase-uid"],
    ]);
    strictEqual(logs.join(" ").includes("firebase-custom-token-secret"), false);
  });

  it("does not mint a token for missing, expired, or consumed tickets", async () => {
    let minted = false;
    const handler = createLineAuthExchangeHandler({
      consumeTicket: async () => { throw new Error("not pending"); },
      getUser: async () => ({}),
      createCustomToken: async () => { minted = true; return "unexpected"; },
      logError: () => undefined,
    });
    strictEqual((await handler(new Request("https://app.example/api/line/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    }))).status, 401);
    strictEqual(minted, false);
  });
});
