import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { createLineInviteSignupHandler, createLineInviteSignupPreviewHandler } from "../lib/server/line-invite-signup-handler.ts";
const request = (body) => new Request("https://app.example/api/line/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("LINE invite signup handlers", () => {
  it("returns only a safe confirmation preview", async () => {
    let received; const handler = createLineInviteSignupPreviewHandler({ preview: async (token) => { received = token; return { projectName: "公演", displayName: "利用者" }; } });
    const response = await handler(request({ signupToken: "opaque", uid: "forged", lineUserId: "forged" }));
    strictEqual(response.status, 200); strictEqual(received, "opaque"); deepStrictEqual(await response.json(), { signup: { projectName: "公演", displayName: "利用者" } });
  });
  it("completes only from the opaque attempt and returns no custom token", async () => {
    let received; const handler = createLineInviteSignupHandler({ complete: async (token) => { received = token; return { ticket: "ticket", projectId: "project-a" }; } });
    const response = await handler(request({ signupToken: "opaque", role: "owner", personId: "forged" }));
    strictEqual(received, "opaque"); deepStrictEqual(await response.json(), { ticket: "ticket", projectId: "project-a" });
  });
});
