import { deepStrictEqual, notStrictEqual, strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import { PROJECT_INVITE_LINK_TTL_MS, buildProjectInviteLinkUrl, getPersonInviteState, getProjectInviteLinkDisplayStatus, getProjectInviteLinkExpiry, isValidProjectInviteLinkToken } from "../lib/project-invite-links.ts";
import { generateProjectInviteLinkToken, hashProjectInviteLinkToken } from "../lib/server/project-invite-link-token.ts";

describe("project invite link primitives", () => {
  it("derives visible person invite state from formal links and valid pending invites", () => {
    const pending = { id: "invite-a", status: "pending", role: "viewer", personId: "person-a", personName: "A", createdAt: null, expiresAt: new Date(Date.now() + 1000).toISOString(), claimedAt: null };
    strictEqual(getPersonInviteState({ personId: "person-a", linkedUserUid: "uid-a", invites: [pending] }), "using");
    strictEqual(getPersonInviteState({ personId: "person-a", linkedUserUid: null, invites: [pending] }), "invited");
    strictEqual(getPersonInviteState({ personId: "person-a", linkedUserUid: null, invites: [{ ...pending, status: "expired" }] }), "not_invited");
    strictEqual(getPersonInviteState({ personId: "person-a", linkedUserUid: null, invites: [{ ...pending, personId: "person-b" }] }), "not_invited");
  });
  it("generates distinct 32-byte base64url tokens and stable SHA-256 ids", () => {
    const first = generateProjectInviteLinkToken(); const second = generateProjectInviteLinkToken();
    strictEqual(first.length, 43); strictEqual(isValidProjectInviteLinkToken(first), true); notStrictEqual(first, second);
    strictEqual(hashProjectInviteLinkToken(first), hashProjectInviteLinkToken(first)); notStrictEqual(hashProjectInviteLinkToken(first), first); throws(() => hashProjectInviteLinkToken("unsafe"));
  });
  it("uses a fixed seven-day expiry and keeps the token in the URL fragment", () => {
    const created = Date.parse("2026-11-10T00:00:00.000Z"); strictEqual(getProjectInviteLinkExpiry(created).getTime() - created, PROJECT_INVITE_LINK_TTL_MS);
    const token = "a".repeat(43); const url = new URL(buildProjectInviteLinkUrl("https://example.test", token));
    strictEqual(url.pathname, "/invite"); strictEqual(url.search, ""); strictEqual(new URLSearchParams(url.hash.slice(1)).get("token"), token);
  });
  it("maps pending, expired, claimed, and revoked statuses deterministically", () => {
    const now = 1000;
    deepStrictEqual([
      getProjectInviteLinkDisplayStatus({ status: "pending", expiresAtMs: 1001, nowMs: now }),
      getProjectInviteLinkDisplayStatus({ status: "pending", expiresAtMs: 1000, nowMs: now }),
      getProjectInviteLinkDisplayStatus({ status: "claimed", expiresAtMs: 0, nowMs: now }),
      getProjectInviteLinkDisplayStatus({ status: "revoked", expiresAtMs: 2000, nowMs: now }),
    ], ["pending", "expired", "claimed", "revoked"]);
  });
});
