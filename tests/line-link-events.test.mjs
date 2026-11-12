import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildLineLinkNotificationMessage, lineLinkEventLabel } from "../lib/line-link-events.ts";
import { createLineLinkEventHandlers } from "../lib/server/line-link-event-handler.ts";

function dependencies(overrides = {}) {
  return {
    verifyIdToken: async () => ({ uid: "owner-a" }),
    list: async () => [],
    repair: async () => ({}),
    ...overrides,
  };
}

const context = { params: Promise.resolve({ projectId: "project-a" }) };

describe("LINE link event helpers", () => {
  it("builds a safe owner notification with required names", () => {
    strictEqual(buildLineLinkNotificationMessage({
      projectName: "第61回公演", personName: "参加者A", lineDisplayName: "LINE名", eventType: "linked",
    }), "SeisakuBoardでLINE連携が完了しました。\n\n公演：第61回公演\n関係者：参加者A\nLINE表示名：LINE名");
    strictEqual(lineLinkEventLabel("relinked"), "再連携");
    strictEqual(lineLinkEventLabel("project_link_removed"), "誤連携を解除");
  });

  it("dispatches persisted events from a secret-bound Firestore trigger", () => {
    const source = readFileSync(new URL("../functions/src/index.ts", import.meta.url), "utf8");
    strictEqual(source.includes("export const onLineLinkEventCreated = onDocumentCreated"), true);
    strictEqual(source.includes("document: LINE_LINK_EVENT_DOCUMENT"), true);
    strictEqual(source.includes("secrets: [lineChannelAccessToken]"), true);
    strictEqual(source.includes("dispatchLineLinkEvent({"), true);
  });

  it("requires authentication and passes only verified uid to history", async () => {
    const calls = [];
    const handlers = createLineLinkEventHandlers(dependencies({
      list: async (input) => { calls.push(input); return [{ id: "event-a" }]; },
    }));
    strictEqual((await handlers.GET(new Request("https://app.test"), context)).status, 401);
    const response = await handlers.GET(new Request("https://app.test", {
      headers: { Authorization: "Bearer token-a" },
    }), context);
    strictEqual(response.status, 200);
    deepStrictEqual(calls, [{ uid: "owner-a", projectId: "project-a" }]);
  });

  it("ignores client uid and repairs only the requested person as the verified owner", async () => {
    const calls = [];
    const handlers = createLineLinkEventHandlers(dependencies({
      repair: async (input) => { calls.push(input); return {}; },
    }));
    const response = await handlers.POST(new Request("https://app.test", {
      method: "POST",
      headers: { Authorization: "Bearer token-a", "Content-Type": "application/json" },
      body: JSON.stringify({ personId: "person-a", ownerUid: "attacker", lineUserId: "secret" }),
    }), context);
    strictEqual(response.status, 200);
    deepStrictEqual(calls, [{ ownerUid: "owner-a", projectId: "project-a", personId: "person-a" }]);
  });
});
