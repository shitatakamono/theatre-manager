import { createHmac } from "node:crypto";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  captureLatestLineFollow,
  parseLineWebhook,
  parseLineWebhookSummary,
  verifyLineWebhookSignature,
} from "../lib/line-webhook.ts";
import { createLineWebhookHandler } from "../lib/server/line-webhook-handler.ts";

const secret = "line-channel-secret-for-tests";

function encode(value) {
  return new TextEncoder().encode(value);
}

function sign(rawBody) {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function request(rawBody, signature = sign(rawBody)) {
  return new Request("https://example.test/api/line/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(signature === null ? {} : { "x-line-signature": signature }),
    },
    body: rawBody,
  });
}

function handler(onVerifiedWebhook) {
  return createLineWebhookHandler({
    getChannelSecret: () => secret,
    onVerifiedWebhook,
  });
}

describe("LINE webhook signature", () => {
  it("accepts the exact raw body and rejects any modification", () => {
    const rawBody = encode('{"events":[]}');
    const signature = sign(rawBody);
    strictEqual(verifyLineWebhookSignature(rawBody, signature, secret), true);
    strictEqual(
      verifyLineWebhookSignature(encode('{"events":[]}\n'), signature, secret),
      false
    );
  });

  it("summarizes known and unknown event types without retaining event content", () => {
    deepStrictEqual(parseLineWebhookSummary(encode(JSON.stringify({
      events: [
        { type: "follow", source: { userId: "not-retained" } },
        { type: "message", message: { text: "not-retained" } },
        { type: "future-event" },
      ],
    }))), {
      eventCount: 3,
      eventTypes: ["follow", "message", "unknown"],
    });
  });

  it("captures only a valid user ID from a follow event", async () => {
    const followUserId = `U${"b".repeat(32)}`;
    const saved = [];
    const follow = parseLineWebhook(encode(JSON.stringify({
      events: [{ type: "follow", source: { type: "user", userId: followUserId } }],
    })));
    strictEqual(await captureLatestLineFollow(follow.context, async (userId) => {
      saved.push(userId);
    }), true);
    deepStrictEqual(saved, [followUserId]);

    const message = parseLineWebhook(encode(JSON.stringify({
      events: [{
        type: "message",
        source: { type: "user", userId: followUserId },
        message: { type: "text", text: "not-retained" },
      }],
    })));
    strictEqual(await captureLatestLineFollow(message.context, async () => {
      throw new Error("message events must not be saved");
    }), false);

    const missing = parseLineWebhook(encode(JSON.stringify({
      events: [{ type: "follow", source: { type: "user" } }],
    })));
    strictEqual(await captureLatestLineFollow(missing.context, async () => {
      throw new Error("follow events without a user ID must not be saved");
    }), false);
  });
});

describe("LINE webhook handler", () => {
  it("returns 200 for a valid signature and multiple events", async () => {
    const summaries = [];
    const rawBody = JSON.stringify({
      destination: "not-retained",
      events: [{ type: "follow" }, { type: "postback" }],
    });
    const response = await handler((summary) => summaries.push(summary))(request(rawBody));
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { success: true });
    deepStrictEqual(summaries, [{
      eventCount: 2,
      eventTypes: ["follow", "postback"],
    }]);
  });

  it("rejects an invalid signature", async () => {
    const response = await handler()(request('{"events":[]}', "invalid"));
    strictEqual(response.status, 401);
    strictEqual((await response.json()).code, "invalid_signature");
  });

  it("rejects a request without x-line-signature", async () => {
    const response = await handler()(request('{"events":[]}', null));
    strictEqual(response.status, 401);
    strictEqual((await response.json()).code, "invalid_signature");
  });

  it("rejects an empty signed body without processing it", async () => {
    let processed = false;
    const response = await handler(() => { processed = true; })(request(""));
    strictEqual(response.status, 400);
    strictEqual((await response.json()).code, "invalid_body");
    strictEqual(processed, false);
  });

  it("safely accepts an unknown event type", async () => {
    const summaries = [];
    const rawBody = JSON.stringify({ events: [{ type: "future-event" }] });
    const response = await handler((summary) => summaries.push(summary))(request(rawBody));
    strictEqual(response.status, 200);
    deepStrictEqual(summaries[0].eventTypes, ["unknown"]);
  });

  it("rejects a raw body changed after its signature was generated", async () => {
    const original = '{"events":[]}';
    const response = await handler()(request(`${original}\n`, sign(original)));
    strictEqual(response.status, 401);
  });
});
