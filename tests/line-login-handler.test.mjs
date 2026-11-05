import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createLineLoginCallbackHandler,
  createLineLoginDisconnectHandler,
  createLineLoginStartHandler,
  createLineLoginStatusHandler,
} from "../lib/server/line-login-handler.ts";
import { LineAccountLinkError } from "../lib/line-account-link.ts";

const state = "a".repeat(43);
const verifier = "v".repeat(43);
const lineUserId = `U${"a".repeat(32)}`;

function startDependencies(overrides = {}) {
  return {
    verifyIdToken: async () => ({ uid: "firebase-uid" }),
    getStatus: async () => ({ connected: false }),
    createState: async () => ({ state, nonce: "nonce-a", codeVerifier: verifier }),
    getConfig: () => ({
      channelId: "channel-a",
      redirectUri: "https://app.example/api/line/login/callback",
    }),
    logError: () => undefined,
    ...overrides,
  };
}

function callbackDependencies(overrides = {}) {
  return {
    readState: async () => ({ status: "pending", uid: "firebase-uid", nonce: "nonce-a", codeVerifier: verifier }),
    failState: async () => undefined,
    exchangeCode: async () => ({ accessToken: "access-a", idToken: "id-a" }),
    verifyIdToken: async () => ({ lineUserId }),
    getFriendshipStatus: async () => true,
    completeState: async () => ({ outcome: "linked" }),
    getConfig: () => ({
      appOrigin: "https://app.example",
      channelId: "channel-a",
      channelSecret: "secret-a",
      redirectUri: "https://app.example/api/line/login/callback",
    }),
    logError: () => undefined,
    ...overrides,
  };
}

function authorizedRequest(url = "https://app.example/api/line/login/start") {
  return new Request(url, { method: "POST", headers: { Authorization: "Bearer firebase-token" } });
}

describe("LINE Login start and status APIs", () => {
  it("requires valid Firebase authentication", async () => {
    const handler = createLineLoginStartHandler(startDependencies());
    strictEqual((await handler(new Request("https://app.example", { method: "POST" }))).status, 401);
    const invalid = createLineLoginStartHandler(startDependencies({ verifyIdToken: async () => { throw new Error("bad"); } }));
    strictEqual((await invalid(authorizedRequest())).status, 401);
  });

  it("creates a server-owned OIDC/PKCE request for the verified uid", async () => {
    const uids = [];
    const handler = createLineLoginStartHandler(startDependencies({
      createState: async (uid) => { uids.push(uid); return { state, nonce: "nonce-a", codeVerifier: verifier }; },
    }));
    const response = await handler(authorizedRequest());
    const body = await response.json();
    const redirect = new URL(body.redirectUrl);
    deepStrictEqual(uids, ["firebase-uid"]);
    strictEqual(redirect.searchParams.get("state"), state);
    strictEqual(redirect.searchParams.get("nonce"), "nonce-a");
    strictEqual(redirect.searchParams.get("scope"), "openid profile");
    strictEqual(redirect.searchParams.get("bot_prompt"), "normal");
    strictEqual(redirect.searchParams.get("redirect_uri"), "https://app.example/api/line/login/callback");
  });

  it("does not create another state for an already-linked user", async () => {
    let created = false;
    const handler = createLineLoginStartHandler(startDependencies({
      getStatus: async () => ({ connected: true }),
      createState: async () => { created = true; throw new Error("unexpected"); },
    }));
    const body = await (await handler(authorizedRequest())).json();
    strictEqual(body.connected, true);
    strictEqual(created, false);
  });

  it("returns only safe status fields after Firebase authentication", async () => {
    const handler = createLineLoginStatusHandler({
      verifyIdToken: async () => ({ uid: "firebase-uid" }),
      getStatus: async () => ({ connected: true, deliveryStatus: "reachable" }),
    });
    strictEqual((await handler(new Request("https://app.example"))).status, 401);
    const response = await handler(new Request("https://app.example", { headers: { Authorization: "Bearer token" } }));
    deepStrictEqual(await response.json(), { connected: true, deliveryStatus: "reachable" });
  });
});

describe("LINE Login disconnect API", () => {
  function disconnectDependencies(overrides = {}) {
    return {
      verifyIdToken: async () => ({ uid: "firebase-uid" }),
      unlink: async () => ({ outcome: "unlinked" }),
      logError: () => undefined,
      ...overrides,
    };
  }

  it("requires valid Firebase authentication", async () => {
    const handler = createLineLoginDisconnectHandler(disconnectDependencies());
    strictEqual((await handler(new Request("https://app.example", { method: "POST" }))).status, 401);
    const invalid = createLineLoginDisconnectHandler(disconnectDependencies({
      verifyIdToken: async () => { throw new Error("invalid token"); },
    }));
    strictEqual((await invalid(authorizedRequest())).status, 401);
  });

  it("unlinks only the verified uid and ignores request body identifiers", async () => {
    const unlinkedUids = [];
    const handler = createLineLoginDisconnectHandler(disconnectDependencies({
      unlink: async (uid) => { unlinkedUids.push(uid); return { outcome: "unlinked" }; },
    }));
    const response = await handler(new Request("https://app.example/api/line/login/disconnect", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "attacker-uid", lineUserId: "attacker-line-id" }),
    }));
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { connected: false });
    deepStrictEqual(unlinkedUids, ["firebase-uid"]);
  });

  it("treats an already-unlinked account as success", async () => {
    const handler = createLineLoginDisconnectHandler(disconnectDependencies({
      unlink: async () => ({ outcome: "already_unlinked" }),
    }));
    strictEqual((await handler(authorizedRequest("https://app.example/api/line/login/disconnect"))).status, 200);
  });

  it("rejects inconsistent pairs without exposing internal details", async () => {
    const handler = createLineLoginDisconnectHandler(disconnectDependencies({
      unlink: async () => { throw new LineAccountLinkError("line_link_inconsistent", "internal"); },
    }));
    const response = await handler(authorizedRequest("https://app.example/api/line/login/disconnect"));
    strictEqual(response.status, 409);
    deepStrictEqual(await response.json(), { error: "LINE連携を解除できませんでした" });
  });
});

describe("LINE Login callback", () => {
  it("does not use a request host as a redirect when server configuration is missing", async () => {
    const handler = createLineLoginCallbackHandler(callbackDependencies({
      getConfig: () => { throw new Error("missing"); },
    }));
    const response = await handler(new Request(`https://evil.example/api/line/login/callback?code=x&state=${state}`));
    strictEqual(response.status, 500);
    strictEqual(response.headers.get("location"), null);
  });

  it("exchanges, verifies, checks friendship, links, and redirects to settings", async () => {
    const calls = [];
    const handler = createLineLoginCallbackHandler(callbackDependencies({
      exchangeCode: async (input) => { calls.push(["exchange", input]); return { accessToken: "access-a", idToken: "id-a" }; },
      verifyIdToken: async (input) => { calls.push(["verify", input]); return { lineUserId }; },
      completeState: async (input) => { calls.push(["complete", input]); return { outcome: "linked" }; },
    }));
    const response = await handler(new Request(`https://app.example/api/line/login/callback?code=code-a&state=${state}`));
    strictEqual(response.status, 303);
    strictEqual(response.headers.get("location"), "https://app.example/settings?line=connected");
    strictEqual(calls[0][1].codeVerifier, verifier);
    strictEqual(calls[1][1].nonce, "nonce-a");
    strictEqual(calls[2][1].lineUserId, lineUserId);
    strictEqual(calls[2][1].deliveryStatus, "reachable");
  });

  it("marks OAuth cancellation and missing code as failed without linking", async () => {
    for (const query of [`error=access_denied&state=${state}`, `state=${state}`]) {
      let failed = 0;
      let linked = false;
      const handler = createLineLoginCallbackHandler(callbackDependencies({
        failState: async () => { failed += 1; },
        completeState: async () => { linked = true; return { outcome: "linked" }; },
      }));
      const response = await handler(new Request(`https://app.example/api/line/login/callback?${query}`));
      strictEqual(response.headers.get("location"), "https://app.example/settings?line=error");
      strictEqual(failed, 1);
      strictEqual(linked, false);
    }
  });

  it("handles missing, expired/failed, and consumed states without exposing details", async () => {
    const noState = createLineLoginCallbackHandler(callbackDependencies());
    strictEqual((await noState(new Request("https://app.example/api/line/login/callback"))).headers.get("location"), "https://app.example/settings?line=error");
    for (const status of ["failed", "consumed"]) {
      const handler = createLineLoginCallbackHandler(callbackDependencies({
        readState: async () => ({ status, uid: "firebase-uid", nonce: "", codeVerifier: "" }),
      }));
      const response = await handler(new Request(`https://app.example/api/line/login/callback?code=x&state=${state}`));
      strictEqual(response.headers.get("location"), `https://app.example/settings?line=${status === "consumed" ? "connected" : "error"}`);
    }
  });

  it("keeps a successful identity link when friendship lookup fails", async () => {
    let completed;
    const handler = createLineLoginCallbackHandler(callbackDependencies({
      getFriendshipStatus: async () => { throw new Error("temporary"); },
      completeState: async (input) => { completed = input; return { outcome: "linked" }; },
    }));
    const response = await handler(new Request(`https://app.example/api/line/login/callback?code=x&state=${state}`));
    strictEqual(response.headers.get("location"), "https://app.example/settings?line=connected");
    strictEqual(completed.deliveryStatus, "unknown");
  });

  it("fails safely for token, ID-token, and link conflicts and never redirects off-site", async () => {
    for (const overrides of [
      { exchangeCode: async () => { throw new Error("token"); } },
      { verifyIdToken: async () => { throw new Error("claims"); } },
      { completeState: async () => { throw new Error("conflict"); } },
    ]) {
      const response = await createLineLoginCallbackHandler(callbackDependencies(overrides))(
        new Request(`https://app.example/api/line/login/callback?code=x&state=${state}`)
      );
      strictEqual(response.headers.get("location"), "https://app.example/settings?line=error");
    }
  });
});
