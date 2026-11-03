import assert from "node:assert/strict";
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
