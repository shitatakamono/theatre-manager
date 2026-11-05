import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { LineAccountLinkError } from "../lib/line-account-link.ts";
import { processLineAccountLinkWebhook } from "../lib/server/line-account-link-webhook.ts";

const lineUserId = `U${"a".repeat(32)}`;

function context(overrides = {}) {
  return {
    accountLinkEvents: [],
    followUserIds: [],
    unfollowUserIds: [],
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  return {
    linkAccount: async () => ({ outcome: "linked" }),
    failNonce: async () => ({ outcome: "failed" }),
    updateDelivery: async () => ({ outcome: "updated" }),
    ...overrides,
  };
}

describe("LINE accountLink webhook processing", () => {
  it("links successful events and consumes failed events without exposing identity", async () => {
    const calls = [];
    const result = await processLineAccountLinkWebhook(context({
      accountLinkEvents: [
        { result: "ok", lineUserId, nonce: "valid_nonce_123456" },
        { result: "failed", nonce: "failed_nonce_123456" },
      ],
    }), dependencies({
      linkAccount: async (input) => {
        calls.push(["link", input]);
        return { outcome: "linked" };
      },
      failNonce: async (nonce) => {
        calls.push(["fail", nonce]);
        return { outcome: "failed" };
      },
    }));

    strictEqual(result.linkedCount, 1);
    strictEqual(result.failedNonceCount, 1);
    strictEqual(calls.length, 2);
  });

  it("treats expected link conflicts as handled business outcomes", async () => {
    const result = await processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "ok", lineUserId, nonce: "valid_nonce_123456" }],
    }), dependencies({
      linkAccount: async () => {
        throw new LineAccountLinkError("line_user_already_linked", "conflict");
      },
    }));
    strictEqual(result.ignoredBusinessErrorCount, 1);
  });

  it("propagates infrastructure failures so the webhook can return 500", async () => {
    await rejects(() => processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "ok", lineUserId, nonce: "valid_nonce_123456" }],
    }), dependencies({
      linkAccount: async () => { throw new Error("firestore unavailable"); },
    })), /firestore unavailable/);
  });

  it("updates linked follow/unfollow and ignores unknown users", async () => {
    const events = [];
    const result = await processLineAccountLinkWebhook(context({
      followUserIds: [lineUserId, `U${"b".repeat(32)}`],
      unfollowUserIds: [lineUserId],
    }), dependencies({
      updateDelivery: async (input) => {
        events.push(input.event);
        return input.lineUserId === lineUserId
          ? { outcome: "updated" }
          : { outcome: "not_linked" };
      },
    }));
    deepStrictEqual(events, ["follow", "follow", "unfollow"]);
    strictEqual(result.deliveryUpdatedCount, 2);
  });
});
