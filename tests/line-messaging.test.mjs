import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINE_PUSH_MESSAGE_ENDPOINT,
  LineMessagingError,
  sendLinePushTextMessage,
} from "../lib/server/line-messaging.ts";

const lineUserId = `U${"a".repeat(32)}`;
const messageText = "通知テスト";

describe("LINE push message helper", () => {
  it("fails safely when the access token is missing", async () => {
    await rejects(() => sendLinePushTextMessage({
      lineUserId,
      text: messageText,
      accessToken: undefined,
    }), (error) => error instanceof LineMessagingError
      && error.code === "line_access_token_missing"
      && error.status === 503);
  });

  it("sends text through the LINE push endpoint", async () => {
    const requests = [];
    await sendLinePushTextMessage({
      lineUserId,
      text: messageText,
      accessToken: "access-token-for-test",
      retryKey: "123e4567-e89b-12d3-a456-426614174000",
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(null, { status: 200 });
      },
    });
    strictEqual(requests[0].url, LINE_PUSH_MESSAGE_ENDPOINT);
    strictEqual(requests[0].init.headers.Authorization, "Bearer access-token-for-test");
    strictEqual(requests[0].init.headers["X-Line-Retry-Key"], "123e4567-e89b-12d3-a456-426614174000");
    deepStrictEqual(JSON.parse(requests[0].init.body), {
      to: lineUserId,
      messages: [{ type: "text", text: messageText }],
    });
  });

  it("treats a retry-key conflict as an already accepted send", async () => {
    await sendLinePushTextMessage({
      lineUserId,
      text: messageText,
      accessToken: "access-token-for-test",
      retryKey: "123e4567-e89b-12d3-a456-426614174000",
      fetchImpl: async () => new Response(null, { status: 409 }),
    });
  });

  it("classifies LINE errors without reading response bodies", async () => {
    for (const [status, code] of [[400, "line_request_rejected"], [500, "line_server_error"]]) {
      let bodyRead = false;
      const response = new Response("must-not-be-read", { status });
      response.text = async () => { bodyRead = true; return "must-not-be-read"; };
      await rejects(() => sendLinePushTextMessage({
        lineUserId,
        text: messageText,
        accessToken: "access-token-for-test",
        fetchImpl: async () => response,
      }), (error) => error instanceof LineMessagingError && error.code === code);
      strictEqual(bodyRead, false);
    }
  });
});
