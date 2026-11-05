import { deepStrictEqual, rejects, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LINE_PUSH_MESSAGE_ENDPOINT,
  LINE_TEST_MESSAGE_TEXT,
  LineMessagingError,
  sendLinePushTextMessage,
} from "../lib/server/line-messaging.ts";
import { createLineTestMessageHandler } from "../lib/server/line-test-message-handler.ts";

const lineUserId = `U${"a".repeat(32)}`;

function request(body, token = "firebase-token") {
  return new Request("https://example.test/api/line/test-message", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function dependencies(overrides = {}) {
  return {
    verifyIdToken: async () => ({ uid: "owner-a" }),
    getProjectRole: async () => "owner",
    sendMessage: async () => undefined,
    logError: () => undefined,
    ...overrides,
  };
}

describe("LINE push message helper", () => {
  it("fails safely when the access token is missing", async () => {
    await rejects(() => sendLinePushTextMessage({
      lineUserId,
      text: LINE_TEST_MESSAGE_TEXT,
      accessToken: undefined,
    }), (error) => error instanceof LineMessagingError
      && error.code === "line_access_token_missing"
      && error.status === 503);
  });

  it("sends the fixed text through the LINE push endpoint", async () => {
    const requests = [];
    await sendLinePushTextMessage({
      lineUserId,
      text: LINE_TEST_MESSAGE_TEXT,
      accessToken: "access-token-for-test",
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(null, { status: 200 });
      },
    });
    strictEqual(requests[0].url, LINE_PUSH_MESSAGE_ENDPOINT);
    strictEqual(requests[0].init.method, "POST");
    strictEqual(requests[0].init.headers.Authorization, "Bearer access-token-for-test");
    deepStrictEqual(JSON.parse(requests[0].init.body), {
      to: lineUserId,
      messages: [{ type: "text", text: LINE_TEST_MESSAGE_TEXT }],
    });
  });

  it("classifies LINE 4xx and 5xx responses without reading their bodies", async () => {
    for (const [status, code] of [[400, "line_request_rejected"], [500, "line_server_error"]]) {
      let bodyRead = false;
      const response = new Response("must-not-be-read", { status });
      const originalText = response.text.bind(response);
      response.text = async () => { bodyRead = true; return originalText(); };
      await rejects(() => sendLinePushTextMessage({
        lineUserId,
        text: LINE_TEST_MESSAGE_TEXT,
        accessToken: "access-token-for-test",
        fetchImpl: async () => response,
      }), (error) => error instanceof LineMessagingError && error.code === code);
      strictEqual(bodyRead, false);
    }
  });
});

describe("LINE test message handler", () => {
  it("rejects an unauthenticated request", async () => {
    const handler = createLineTestMessageHandler(dependencies());
    const response = await handler(new Request("https://example.test/api/line/test-message", {
      method: "POST",
    }));
    strictEqual(response.status, 401);
  });

  it("rejects a non-owner project member", async () => {
    const handler = createLineTestMessageHandler(dependencies({
      getProjectRole: async () => "editor",
    }));
    const response = await handler(request({ projectId: "project-a", lineUserId }));
    strictEqual(response.status, 403);
    strictEqual((await response.json()).code, "forbidden");
  });

  it("requires a LINE user ID", async () => {
    const handler = createLineTestMessageHandler(dependencies());
    const response = await handler(request({ projectId: "project-a" }));
    strictEqual(response.status, 400);
    strictEqual((await response.json()).code, "invalid_request");
  });

  it("sends only the server-defined fixed message for an owner", async () => {
    const sends = [];
    const handler = createLineTestMessageHandler(dependencies({
      sendMessage: async (input) => { sends.push(input); },
    }));
    const response = await handler(request({
      projectId: "project-a",
      lineUserId,
      message: "自由入力は送信しない",
    }));
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { success: true });
    deepStrictEqual(sends, [{ lineUserId, text: LINE_TEST_MESSAGE_TEXT }]);
  });

  it("returns and logs only safe error metadata", async () => {
    const logs = [];
    const handler = createLineTestMessageHandler(dependencies({
      sendMessage: async () => {
        throw new LineMessagingError("line_server_error", 503, 500);
      },
      logError: (...values) => logs.push(values),
    }));
    const response = await handler(request({ projectId: "project-a", lineUserId }));
    strictEqual(response.status, 503);
    deepStrictEqual(await response.json(), {
      error: "LINEへのテスト送信に失敗しました",
      code: "line_server_error",
    });
    const serializedLogs = JSON.stringify(logs);
    for (const forbidden of [lineUserId, LINE_TEST_MESSAGE_TEXT, "access-token-for-test"]) {
      strictEqual(serializedLogs.includes(forbidden), false);
    }
  });
});
