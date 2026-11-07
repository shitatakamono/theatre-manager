import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import nextConfig from "../next.config.js";

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
    assert.match(source, /getRedirectResult/);
    assert.match(source, /completeAuthenticatedUserBootstrap/);
    assert.match(source, /claimPendingUserLinkReservationsClient/);
    assert.match(source, /auth\/popup-blocked/);
    assert.doesNotMatch(source, /allowRedirectFallback/);
    assert.doesNotMatch(source, /line-in-app-browser/);
  });
});
