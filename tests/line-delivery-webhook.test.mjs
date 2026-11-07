import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { processLineDeliveryWebhook } from "../lib/server/line-delivery-webhook.ts";

const lineUserId = `U${"a".repeat(32)}`;

describe("LINE delivery webhook processing", () => {
  it("updates linked follow/unfollow and ignores unknown users", async () => {
    const calls = [];
    const result = await processLineDeliveryWebhook({
      followUserIds: [lineUserId, `U${"b".repeat(32)}`],
      unfollowUserIds: [lineUserId],
    }, {
      updateDelivery: async (input) => {
        calls.push(input);
        return input.lineUserId === lineUserId
          ? { outcome: "updated" }
          : { outcome: "not_linked" };
      },
    });
    deepStrictEqual(calls.map(({ event }) => event), ["follow", "follow", "unfollow"]);
    strictEqual(result.deliveryUpdatedCount, 2);
  });

  it("propagates infrastructure failures so the webhook can retry", async () => {
    await rejects(() => processLineDeliveryWebhook({
      followUserIds: [lineUserId],
      unfollowUserIds: [],
    }, {
      updateDelivery: async () => { throw new Error("firestore unavailable"); },
    }), /firestore unavailable/);
  });
});
