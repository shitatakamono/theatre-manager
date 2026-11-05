import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  LINE_LINK_TOKEN_ENDPOINT_BASE,
  LINE_REPLY_MESSAGE_ENDPOINT,
  LineMessagingError,
  issueLineAccountLinkToken,
  replyLineAccountLinkGuide,
} from "../lib/server/line-messaging.ts";
import {
  createLineAccountLinkPageUrl,
  processLineAccountLinkRequestWebhook,
} from "../lib/server/line-account-link-request-webhook.ts";
import { createLineWebhookHandler } from "../lib/server/line-webhook-handler.ts";

const lineUserId = `U${"a".repeat(32)}`;

function context(events) {
  return {
    accountLinkEvents: [],
    accountLinkRequestEvents: events,
    followUserIds: [],
    unfollowUserIds: [],
  };
}

describe("LINE account-link Messaging API", () => {
  it("issues a link token without logging or persisting the response", async () => {
    const calls = [];
    const token = await issueLineAccountLinkToken({
      lineUserId,
      accessToken: "test-access-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json({ linkToken: "valid_link_token_123456" });
      },
    });
    strictEqual(token, "valid_link_token_123456");
    strictEqual(calls[0].url, `${LINE_LINK_TOKEN_ENDPOINT_BASE}/${lineUserId}/linkToken`);
    strictEqual(calls[0].init.method, "POST");
  });

  it("rejects missing credentials, non-2xx, malformed responses, and network errors", async () => {
    await rejects(() => issueLineAccountLinkToken({ lineUserId, accessToken: undefined }),
      (error) => error instanceof LineMessagingError && error.code === "line_access_token_missing");
    await rejects(() => issueLineAccountLinkToken({
      lineUserId,
      accessToken: "token",
      fetchImpl: async () => new Response("not read", { status: 500 }),
    }), (error) => error instanceof LineMessagingError && error.code === "line_server_error");
    await rejects(() => issueLineAccountLinkToken({
      lineUserId,
      accessToken: "token",
      fetchImpl: async () => Response.json({ unexpected: true }),
    }), (error) => error instanceof LineMessagingError && error.code === "line_invalid_response");
    await rejects(() => issueLineAccountLinkToken({
      lineUserId,
      accessToken: "token",
      fetchImpl: async () => { throw new Error("network"); },
    }), (error) => error instanceof LineMessagingError && error.code === "line_network_error");
  });

  it("replies with a supported buttons template and keeps the token out of visible text", async () => {
    const calls = [];
    const accountLinkPageUrl = createLineAccountLinkPageUrl(
      "https://seisakuboard.geki-curry.com",
      "valid_link_token_123456"
    );
    await replyLineAccountLinkGuide({
      replyToken: "reply-token",
      accountLinkPageUrl,
      accessToken: "test-access-token",
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return new Response(null, { status: 200 });
      },
    });
    strictEqual(calls[0].url, LINE_REPLY_MESSAGE_ENDPOINT);
    const body = JSON.parse(calls[0].init.body);
    strictEqual(body.messages[0].type, "template");
    strictEqual(body.messages[0].template.actions[0].uri, accountLinkPageUrl);
    strictEqual(JSON.stringify(body.messages[0].template.text).includes("valid_link_token"), false);
  });
});

describe("LINE account-link request webhook", () => {
  it("starts link-token issuance only after a valid signed command webhook", async () => {
    const secret = "channel-secret";
    const rawBody = JSON.stringify({ events: [{
      type: "message",
      replyToken: "reply-token",
      source: { userId: lineUserId },
      message: { type: "text", text: "連携" },
    }] });
    let issued = 0;
    const handler = createLineWebhookHandler({
      getChannelSecret: () => secret,
      onVerifiedWebhook: async (_summary, parsedContext) => {
        await processLineAccountLinkRequestWebhook(parsedContext, {
          appOrigin: "https://seisakuboard.geki-curry.com",
          isLinked: async () => false,
          issueLinkToken: async () => { issued += 1; return "valid_link_token_123456"; },
          replyGuide: async () => undefined,
          replyAlreadyLinked: async () => undefined,
        });
      },
    });
    const response = await handler(new Request("https://example.test/api/line/webhook", {
      method: "POST",
      headers: {
        "x-line-signature": createHmac("sha256", secret).update(rawBody).digest("base64"),
      },
      body: rawBody,
    }));
    strictEqual(response.status, 200);
    strictEqual(issued, 1);
  });

  it("issues a token and replies only for an unlinked LINE account", async () => {
    const calls = [];
    const result = await processLineAccountLinkRequestWebhook(context([{
      lineUserId,
      replyToken: "reply-token",
    }]), {
      appOrigin: "https://seisakuboard.geki-curry.com",
      isLinked: async () => false,
      issueLinkToken: async () => "valid_link_token_123456",
      replyGuide: async (input) => { calls.push(input); },
      replyAlreadyLinked: async () => { throw new Error("must not reply as linked"); },
    });
    strictEqual(result.guideReplyCount, 1);
    strictEqual(calls[0].accountLinkPageUrl,
      "https://seisakuboard.geki-curry.com/line/account-link?linkToken=valid_link_token_123456");
  });

  it("does not issue a new token for an already linked LINE account", async () => {
    const replies = [];
    const result = await processLineAccountLinkRequestWebhook(context([{
      lineUserId,
      replyToken: "reply-token",
    }]), {
      appOrigin: "https://seisakuboard.geki-curry.com",
      isLinked: async () => true,
      issueLinkToken: async () => { throw new Error("must not issue"); },
      replyGuide: async () => { throw new Error("must not guide"); },
      replyAlreadyLinked: async (replyToken) => { replies.push(replyToken); },
    });
    deepStrictEqual(replies, ["reply-token"]);
    strictEqual(result.alreadyLinkedReplyCount, 1);
  });
});
