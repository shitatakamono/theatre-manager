import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import { createLineTestUserGetHandler } from "../lib/server/line-test-user-handler.ts";

const lineUserId = `U${"c".repeat(32)}`;

function request(token = "firebase-token") {
  return new Request("https://example.test/api/line/test-user?projectId=project-a", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

function dependencies(overrides = {}) {
  return {
    verifyIdToken: async () => ({ uid: "owner-a" }),
    getProjectRole: async () => "owner",
    getLatestFollow: async () => ({ lineUserId }),
    ...overrides,
  };
}

describe("LINE test user handler", () => {
  it("rejects an unauthenticated request", async () => {
    const response = await createLineTestUserGetHandler(dependencies())(request(""));
    strictEqual(response.status, 401);
  });

  it("rejects Viewer and Editor roles", async () => {
    for (const role of ["viewer", "editor"]) {
      const response = await createLineTestUserGetHandler(dependencies({
        getProjectRole: async () => role,
      }))(request());
      strictEqual(response.status, 403);
      strictEqual((await response.json()).code, "forbidden");
    }
  });

  it("returns the latest follow user ID to an Owner", async () => {
    const response = await createLineTestUserGetHandler(dependencies())(request());
    strictEqual(response.status, 200);
    deepStrictEqual(await response.json(), { success: true, lineUserId });
  });

  it("returns not_found when no follow event has been captured", async () => {
    const response = await createLineTestUserGetHandler(dependencies({
      getLatestFollow: async () => null,
    }))(request());
    strictEqual(response.status, 404);
    strictEqual((await response.json()).code, "not_found");
  });
});
