import { createHmac } from "node:crypto";
import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
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

describe("LINE webhook signature and parsing", () => {
  it("accepts the exact raw body and rejects any modification", () => {
    const rawBody = encode('{"events":[]}');
    const signature = sign(rawBody);
    strictEqual(verifyLineWebhookSignature(rawBody, signature, secret), true);
    strictEqual(verifyLineWebhookSignature(encode('{"events":[]}\n'), signature, secret), false);
  });

  it("keeps supported event summaries without retaining message content", () => {
    deepStrictEqual(parseLineWebhookSummary(encode(JSON.stringify({
      events: [
        { type: "follow", source: { userId: "not-retained" } },
        { type: "message", message: { text: "not-retained" } },
        { type: "postback", postback: { data: "not-retained" } },
        { type: "future-event" },
      ],
    }))), {
      eventCount: 4,
      eventTypes: ["follow", "message", "postback", "unknown"],
    });
  });

  it("collects only valid follow and unfollow user IDs", () => {
    const lineUserId = `U${"e".repeat(32)}`;
    const parsed = parseLineWebhook(encode(JSON.stringify({
      events: [
        { type: "follow", source: { userId: lineUserId } },
        { type: "unfollow", source: { userId: lineUserId } },
        { type: "follow", source: { userId: "invalid" } },
      ],
    })));
    deepStrictEqual(parsed.context, {
      followUserIds: [lineUserId],
      unfollowUserIds: [lineUserId],
    });
  });

  it("treats the former accountLink event and the text '連携' as ordinary safe input", () => {
    const lineUserId = `U${"f".repeat(32)}`;
    const parsed = parseLineWebhook(encode(JSON.stringify({
      events: [
        { type: "accountLink", source: { userId: lineUserId }, link: { result: "ok", nonce: "old-nonce" } },
        { type: "message", replyToken: "old-reply", source: { userId: lineUserId }, message: { type: "text", text: "連携" } },
      ],
    })));
    deepStrictEqual(parsed.summary.eventTypes, ["unknown", "message"]);
    deepStrictEqual(parsed.context, { followUserIds: [], unfollowUserIds: [] });
  });
});

describe("LINE webhook handler", () => {
  it("returns 200 for valid follow, message, postback, and unknown events", async () => {
    const summaries = [];
    const rawBody = JSON.stringify({
      events: [
        { type: "follow" },
        { type: "message" },
        { type: "postback" },
        { type: "future-event" },
      ],
    });
    const response = await handler((summary) => summaries.push(summary))(request(rawBody));
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { success: true });
    deepStrictEqual(summaries[0].eventTypes, ["follow", "message", "postback", "unknown"]);
  });

  it("rejects invalid or missing signatures", async () => {
    strictEqual((await handler()(request('{"events":[]}', "invalid"))).status, 401);
    strictEqual((await handler()(request('{"events":[]}', null))).status, 401);
  });

  it("rejects invalid JSON and accepts an unknown event safely", async () => {
    strictEqual((await handler()(request(""))).status, 400);
    strictEqual((await handler()(request(JSON.stringify({ events: [{ type: "future-event" }] })))).status, 200);
  });
});
