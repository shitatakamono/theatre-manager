import { strictEqual, throws } from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMemberInvitePayload,
  getMemberDisplayName,
  isExistingMemberEmail,
  isValidInviteEmail,
  normalizeInviteEmail,
} from "../lib/member-invites.ts";

describe("member invite email", () => {
  it("trims and lowercases an invite email", () => {
    strictEqual(normalizeInviteEmail("  Member@Example.COM "), "member@example.com");
  });

  it("accepts normal Google account emails and rejects unsafe document IDs", () => {
    strictEqual(isValidInviteEmail("member+team@example.com"), true);
    strictEqual(isValidInviteEmail("member/name@example.com"), false);
    strictEqual(isValidInviteEmail("not-an-email"), false);
  });

  it("detects an existing member without case sensitivity", () => {
    strictEqual(isExistingMemberEmail([{ uid: "uid", role: "editor", email: "Member@Example.com" }], "member@example.COM"), true);
    strictEqual(isExistingMemberEmail([{ uid: "uid", role: "editor" }], "member@example.com"), false);
  });
});

describe("member invite payload", () => {
  it("uses the safe display name fallback", () => {
    strictEqual(getMemberDisplayName({}), "名前未設定のユーザー");
    strictEqual(getMemberDisplayName({ displayName: " 田中 " }), "田中");
  });

  it("builds a pending editor invite", () => {
    const payload = buildMemberInvitePayload({
      projectId: "project-a",
      projectName: " 第61回公演 ",
      email: " Member@Example.com ",
      role: "editor",
      invitedBy: { uid: "owner-a", displayName: "Owner" },
    }, "timestamp");
    strictEqual(payload.email, "member@example.com");
    strictEqual(payload.projectName, "第61回公演");
    strictEqual(payload.status, "pending");
    strictEqual(payload.acceptedAt, null);
    strictEqual(payload.emailStatus, "not_sent");
    strictEqual(payload.emailSentAt, null);
    strictEqual(payload.emailLastError, null);
    strictEqual(payload.emailSendCount, 0);
    strictEqual(payload.emailLastAttemptAt, null);
  });

  it("rejects an owner invitation", () => {
    throws(() => buildMemberInvitePayload({
      projectId: "project-a", projectName: "公演", email: "member@example.com",
      role: "owner", invitedBy: { uid: "owner-a" },
    }, "timestamp"));
  });
});
