import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import nextConfig from "../next.config.js";
import { isPublicAppPath } from "../lib/auth-paths.ts";

describe("Firebase Authentication custom auth domain proxy", () => {
  it("proxies every Firebase auth helper path without redirecting the browser", async () => {
    const rewrites = await nextConfig.rewrites();

    assert.deepEqual(rewrites, [
      {
        source: "/__/auth/:path*",
        destination: "https://theatre-manager-86e4e.firebaseapp.com/__/auth/:path*",
      },
    ]);
  });
});

describe("Firebase Authentication login flows", () => {
  it("runs the shared authenticated bootstrap for popup and redirect sign-in results", async () => {
    const source = await readFile(new URL("../app/AuthProvider.tsx", import.meta.url), "utf8");

    assert.match(source, /signInWithPopup/);
    assert.match(source, /signInWithRedirect/);
    assert.match(source, /LINEでログイン/);
    assert.ok(source.indexOf("LINEでログイン") < source.indexOf("Googleでログイン（既存利用者）"));
    assert.match(source, /招待リンクからLINEで参加/);
    assert.match(source, /\/api\/line\/auth\/start/);
    assert.match(source, /getRedirectResult/);
    assert.match(source, /completeAuthenticatedUserBootstrap/);
    assert.match(source, /claimPendingUserLinkReservationsClient/);
    assert.match(source, /isPublicAppPath\(pathname\)/);
    assert.match(source, /auth\/popup-blocked/);
    assert.doesNotMatch(source, /allowRedirectFallback/);
    assert.doesNotMatch(source, /line-in-app-browser/);
  });

  it("allows only the public rehearsal token route through the auth boundary", () => {
    assert.equal(isPublicAppPath("/s/rehearsals/valid-token"), true);
    assert.equal(isPublicAppPath("/s/rehearsals/valid-token/extra"), false);
    assert.equal(isPublicAppPath("/s/rehearsals"), false);
    assert.equal(isPublicAppPath("/s/other"), false);
    assert.equal(isPublicAppPath("/projects/project-a"), false);
    assert.equal(isPublicAppPath("/settings"), false);
    assert.equal(isPublicAppPath("/line/auth/complete"), true);
    assert.equal(isPublicAppPath("/line/auth/complete/extra"), false);
    assert.equal(isPublicAppPath("/invite"), true);
    assert.equal(isPublicAppPath("/invite/extra"), false);
  });
});
