import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { LineInviteSignupError } from "../lib/line-invite-signup.ts";
import { createLineInviteSignupHandler, createLineInviteSignupPreviewHandler } from "../lib/server/line-invite-signup-handler.ts";
const request = (body) => new Request("https://app.example/api/line/auth/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("LINE invite signup handlers", () => {
  it("returns only a safe confirmation preview", async () => {
    let received; const handler = createLineInviteSignupPreviewHandler({ preview: async (token) => { received = token; return { projectName: "公演", displayName: "利用者", personName: "参加者A", existingAccountRequired: false }; } });
    const response = await handler(request({ signupToken: "opaque", uid: "forged", lineUserId: "forged" }));
    strictEqual(response.status, 200); strictEqual(received, "opaque"); deepStrictEqual(await response.json(), { signup: { projectName: "公演", displayName: "利用者", personName: "参加者A", existingAccountRequired: false } });
  });
  it("completes only from the opaque attempt and returns no custom token", async () => {
    let received; const handler = createLineInviteSignupHandler({ complete: async (token) => { received = token; return { ticket: "ticket", projectId: "project-a" }; } });
    const response = await handler(request({ signupToken: "opaque", role: "owner", personId: "forged" }));
    strictEqual(received, "opaque"); deepStrictEqual(await response.json(), { ticket: "ticket", projectId: "project-a" });
  });
  it("returns safe existing-account guidance without exposing the conflicting uid", async () => {
    const handler = createLineInviteSignupHandler({
      complete: async () => { throw new LineInviteSignupError("existing_account_required", 409); },
      logError: () => undefined,
    });
    const response = await handler(request({ signupToken: "opaque" }));
    strictEqual(response.status, 409);
    deepStrictEqual(await response.json(), {
      error: "この関係者情報はすでにSeisakuBoardで利用されています。既存アカウントで本人確認してください。",
    });
  });
});
