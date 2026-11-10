import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { createProjectInviteLinkClaimHandler, createProjectInviteLinkManagementHandlers, createProjectInviteLinkPreviewHandler } from "../lib/server/project-invite-link-handler.ts";
const context = { params: Promise.resolve({ projectId: "project-a" }) };

describe("project invite link handlers", () => {
  it("requires authentication and uses only verified uid and route project", async () => {
    let input; const handlers = createProjectInviteLinkManagementHandlers({ verifyIdToken: async () => ({ uid: "owner-a" }), list: async () => [], create: async (value) => { input = value; return { url: "safe" }; }, revoke: async () => undefined });
    strictEqual((await handlers.POST(new Request("https://app.test/api/projects/project-a/invite-links", { method: "POST" }), context)).status, 401);
    const response = await handlers.POST(new Request("https://app.test/api/projects/project-a/invite-links", { method: "POST", headers: { authorization: "Bearer valid", "content-type": "application/json" }, body: JSON.stringify({ personId: "person-a", uid: "attacker", projectId: "other", role: "owner" }) }), context);
    strictEqual(response.status, 201); deepStrictEqual(input, { uid: "owner-a", projectId: "project-a", personId: "person-a", appOrigin: "https://app.test" });
  });
  it("returns only safe preview fields", async () => {
    const handler = createProjectInviteLinkPreviewHandler({ preview: async () => ({ projectName: "公演", role: "viewer", expiresAt: "date", status: "pending" }) });
    const response = await handler(new Request("https://app.test/api/project-invite-links/preview", { method: "POST", body: JSON.stringify({ token: "secret" }) })); const body = await response.json();
    strictEqual(response.status, 200); deepStrictEqual(body, { invite: { projectName: "公演", role: "viewer", expiresAt: "date", status: "pending" } }); strictEqual(JSON.stringify(body).includes("secret"), false);
  });
  it("claims with the verified Firebase uid and ignores forged identity fields", async () => {
    let input; const handler = createProjectInviteLinkClaimHandler({ verifyIdToken: async () => ({ uid: "verified-a" }), getUser: async () => ({ uid: "verified-a", displayName: "利用者", email: "USER@example.test" }), claim: async (value) => { input = value; return { projectId: "project-a", outcome: "claimed" }; } });
    const response = await handler(new Request("https://app.test/api/project-invite-links/claim", { method: "POST", headers: { authorization: "Bearer valid", "content-type": "application/json" }, body: JSON.stringify({ token: "raw", uid: "attacker", personId: "other", projectId: "other", role: "owner" }) }));
    strictEqual(response.status, 200); deepStrictEqual(input, { uid: "verified-a", displayName: "利用者", email: "USER@example.test", rawToken: "raw" });
  });
});
