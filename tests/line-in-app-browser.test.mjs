import { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINE_EXTERNAL_BROWSER_GUIDANCE,
  isLineInAppBrowser,
  shouldRemoveLineAccountLinkQuery,
  shouldUseFirebaseRedirectFallback,
} from "../lib/line-in-app-browser.ts";

describe("LINE in-app browser detection", () => {
  it("provides a user-facing external browser instruction", () => {
    strictEqual(LINE_EXTERNAL_BROWSER_GUIDANCE.includes("右下のメニュー"), true);
    strictEqual(LINE_EXTERNAL_BROWSER_GUIDANCE.includes("SafariまたはChrome"), true);
  });

  it("detects LINE WebViews without classifying normal Safari or Chrome", () => {
    strictEqual(isLineInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Line/15.4.0"
    ), true);
    strictEqual(isLineInAppBrowser(
      "Mozilla/5.0 (Linux; Android 15; wv) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36 LINE/15.4.0"
    ), true);
    strictEqual(isLineInAppBrowser(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1"
    ), false);
    strictEqual(isLineInAppBrowser(
      "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"
    ), false);
  });

  it("keeps the query only in LINE so the external-browser handoff retains the token", () => {
    strictEqual(shouldRemoveLineAccountLinkQuery(true), false);
    strictEqual(shouldRemoveLineAccountLinkQuery(false), true);
  });

  it("blocks redirect fallback when the caller disallows it and preserves normal fallback", () => {
    const errorCode = "auth/web-storage-unsupported";
    strictEqual(shouldUseFirebaseRedirectFallback({
      errorCode,
      allowRedirectFallback: false,
    }), false);
    strictEqual(shouldUseFirebaseRedirectFallback({
      errorCode,
      allowRedirectFallback: true,
    }), true);
  });
});
