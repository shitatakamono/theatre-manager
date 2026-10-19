import {
  deepStrictEqual,
  doesNotMatch,
  equal,
  match,
  rejects,
} from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInviteEmailContent,
  deliverInviteEmail,
  InviteEmailRequestError,
  validateInviteEmailSend,
} from "../lib/member-invite-email.ts";
import { createMemberInviteEmailPostHandler } from "../lib/server/member-invite-email-handler.ts";

const nowMs = Date.parse("2026-10-16T00:00:00.000Z");

function policy(overrides = {}) {
  return {
    memberRole: "owner",
    projectExists: true,
    inviteExists: true,
    requestedEmail: "member@example.com",
    storedEmail: "member@example.com",
    status: "pending",
    role: "editor",
    lastAttemptAtMs: null,
    nowMs,
    ...overrides,
  };
}

function handlerDependencies(overrides = {}) {
  return {
    loadAuthModule: async () => ({
      initializeFirebaseAdminAuth: () => ({
        verifyIdToken: async () => ({ uid: "owner-a" }),
      }),
    }),
    sendPendingInviteEmail: async () => ({ email: "member@example.com" }),
    ...overrides,
  };
}

function authFailure(name, code, secrets) {
  return Object.assign(new Error(secrets.message), {
    name,
    code,
    authorization: secrets.authorization,
    privateKey: secrets.privateKey,
    apiKey: secrets.apiKey,
    email: secrets.email,
  });
}

async function assertSafeAuthFailure({ loadAuthModule, expectedEvent }) {
  const logged = [];
  const secrets = {
    authorization: "Bearer secret-id-token",
    privateKey: "-----BEGIN PRIVATE KEY-----secret",
    apiKey: "secret-api-key",
    email: "member@example.com",
    message: "secret error message",
  };
  const handler = createMemberInviteEmailPostHandler(handlerDependencies({
    loadAuthModule: () => loadAuthModule(authFailure("FirebaseAuthError", "auth/invalid-id-token", secrets)),
    logger: { error: (...values) => { logged.push(values); } },
  }));
  const response = await handler(new Request("https://example.test/api/member-invites/send", {
    method: "POST",
    headers: { authorization: secrets.authorization },
    body: JSON.stringify({ projectId: "project-a", inviteEmail: secrets.email }),
  }));

  equal(response.status, 401);
  deepStrictEqual(await response.json(), { error: "認証情報を確認できませんでした" });
  deepStrictEqual(logged, [[
    expectedEvent,
    { name: "FirebaseAuthError", code: "auth/invalid-id-token" },
  ]]);
  const serializedLog = JSON.stringify(logged);
  for (const secret of Object.values(secrets)) {
    doesNotMatch(serializedLog, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
}

describe("invite email API authentication", () => {
  it("rejects an unauthenticated request", async () => {
    let firebaseAdminWasUsed = false;
    const handler = createMemberInviteEmailPostHandler(handlerDependencies({
      loadAuthModule: async () => {
        firebaseAdminWasUsed = true;
        return {
          initializeFirebaseAdminAuth: () => ({
            verifyIdToken: async () => ({ uid: "unused" }),
          }),
        };
      },
      sendPendingInviteEmail: async () => {
        firebaseAdminWasUsed = true;
        return { email: "unused@example.com" };
      },
    }));
    const response = await handler(new Request("https://example.test/api/member-invites/send", {
      method: "POST",
      body: JSON.stringify({ projectId: "project-a", inviteEmail: "member@example.com" }),
    }));
    equal(response.status, 401);
    equal(firebaseAdminWasUsed, false);
  });

  it("logs only a safe module import failure", async () => {
    await assertSafeAuthFailure({
      expectedEvent: "member_invite_auth_module_import_failed",
      loadAuthModule: async (error) => { throw error; },
    });
  });

  it("logs only a safe Firebase Admin initialization failure", async () => {
    await assertSafeAuthFailure({
      expectedEvent: "member_invite_admin_initialization_failed",
      loadAuthModule: async (error) => ({
        initializeFirebaseAdminAuth: () => { throw error; },
      }),
    });
  });

  it("logs only a safe ID token verification failure", async () => {
    await assertSafeAuthFailure({
      expectedEvent: "member_invite_verify_id_token_failed",
      loadAuthModule: async (error) => ({
        initializeFirebaseAdminAuth: () => ({
          verifyIdToken: async () => { throw error; },
        }),
      }),
    });
  });

  it("uses the verified UID and ignores forged recipient, role, and project name", async () => {
    let received;
    const handler = createMemberInviteEmailPostHandler(handlerDependencies({
      sendPendingInviteEmail: async (input) => {
        received = input;
        return { email: "member@example.com" };
      },
    }));
    const response = await handler(new Request("https://example.test/api/member-invites/send", {
      method: "POST",
      headers: { authorization: "Bearer valid" },
      body: JSON.stringify({
        projectId: "project-a",
        inviteEmail: "member@example.com",
        to: "attacker@example.com",
        role: "owner",
        projectName: "偽装公演",
      }),
    }));
    equal(response.status, 200);
    deepStrictEqual(received, {
      uid: "owner-a",
      projectId: "project-a",
      inviteEmail: "member@example.com",
    });
  });

  for (const [label, status, code] of [
    ["Editor", 403, "owner_required"],
    ["Viewer", 403, "owner_required"],
    ["nonmember", 403, "owner_required"],
    ["accepted invite", 409, "invite_not_pending"],
    ["revoked invite", 409, "invite_not_pending"],
  ]) {
    it(`returns the server authorization failure for ${label}`, async () => {
      const handler = createMemberInviteEmailPostHandler(handlerDependencies({
        loadAuthModule: async () => ({
          initializeFirebaseAdminAuth: () => ({
            verifyIdToken: async () => ({ uid: "verified-user" }),
          }),
        }),
        sendPendingInviteEmail: async () => {
          throw new InviteEmailRequestError(status, code, "送信不可");
        },
      }));
      const response = await handler(new Request("https://example.test/api/member-invites/send", {
        method: "POST",
        headers: { authorization: "Bearer valid" },
        body: JSON.stringify({ projectId: "project-a", inviteEmail: "member@example.com" }),
      }));
      const body = await response.json();
      equal(response.status, status);
      equal(body.code, code);
    });
  }

  it("returns a retryable failed email state without deleting the invite", async () => {
    const handler = createMemberInviteEmailPostHandler(handlerDependencies({
      sendPendingInviteEmail: async () => {
        throw new InviteEmailRequestError(502, "send_failed", "送信失敗");
      },
    }));
    const response = await handler(new Request("https://example.test/api/member-invites/send", {
      method: "POST",
      headers: { authorization: "Bearer valid" },
      body: JSON.stringify({ projectId: "project-a", inviteEmail: "member@example.com" }),
    }));
    const body = await response.json();
    equal(response.status, 502);
    equal(body.emailStatus, "failed");
  });
});

describe("invite email authorization policy", () => {
  it("allows an owner to send a pending editor or viewer invite", () => {
    deepStrictEqual(validateInviteEmailSend(policy()), { email: "member@example.com", role: "editor" });
    deepStrictEqual(validateInviteEmailSend(policy({ role: "viewer" })), { email: "member@example.com", role: "viewer" });
  });

  for (const memberRole of ["editor", "viewer", null]) {
    it(`rejects ${memberRole ?? "nonmember"}`, () => {
      try {
        validateInviteEmailSend(policy({ memberRole }));
        throw new Error("expected policy rejection");
      } catch (error) {
        equal(error instanceof InviteEmailRequestError, true);
        equal(error.status, 403);
      }
    });
  }

  for (const status of ["accepted", "revoked"]) {
    it(`rejects a ${status} invite`, () => {
      try {
        validateInviteEmailSend(policy({ status }));
        throw new Error("expected policy rejection");
      } catch (error) {
        equal(error.status, 409);
      }
    });
  }

  it("uses only the email stored on the invite", () => {
    try {
      validateInviteEmailSend(policy({ storedEmail: "actual@example.com" }));
      throw new Error("expected policy rejection");
    } catch (error) {
      equal(error.code, "invalid_invite");
    }
  });

  it("blocks another send within 60 seconds and permits it after the cooldown", () => {
    try {
      validateInviteEmailSend(policy({ lastAttemptAtMs: nowMs - 59_999 }));
      throw new Error("expected cooldown rejection");
    } catch (error) {
      equal(error.status, 429);
    }
    deepStrictEqual(
      validateInviteEmailSend(policy({ lastAttemptAtMs: nowMs - 60_000 })),
      { email: "member@example.com", role: "editor" }
    );
  });
});

describe("invite email content and delivery", () => {
  const invite = {
    email: "member@example.com",
    projectName: "第61回公演",
    role: "editor",
    invitedByName: "田中",
  };

  it("includes required Japanese guidance without internal identifiers", () => {
    const content = buildInviteEmailContent({ ...invite, appUrl: "https://example.test/" });
    match(content.subject, /第61回公演/);
    for (const value of ["第61回公演", "編集者", "田中", "https://example.test", "Googleアカウント", "心当たり"] ) {
      match(content.text, new RegExp(value));
    }
    doesNotMatch(`${content.text}${content.html}`, /owner-uid|firebase-project|invite-document/i);
  });

  it("sends to the reserved invite email and marks the invite sent", async () => {
    let message;
    const state = { status: "pending", emailStatus: "not_sent" };
    await deliverInviteEmail(invite, {
      from: "SeisakuBoard <hello@example.test>",
      appUrl: "https://example.test",
    }, {
      send: async (value) => { message = value; },
      markSent: async () => { state.emailStatus = "sent"; },
      markFailed: async () => { state.emailStatus = "failed"; },
    });
    deepStrictEqual(message.to, ["member@example.com"]);
    equal(state.status, "pending");
    equal(state.emailStatus, "sent");
  });

  it("keeps the pending invite and records failure when Resend rejects", async () => {
    const state = { status: "pending", emailStatus: "not_sent", error: null };
    await rejects(deliverInviteEmail(invite, {
      from: "SeisakuBoard <hello@example.test>",
      appUrl: "https://example.test",
    }, {
      send: async () => { throw new Error("mock Resend failure"); },
      markSent: async () => { state.emailStatus = "sent"; },
      markFailed: async (code) => { state.emailStatus = "failed"; state.error = code; },
    }));
    equal(state.status, "pending");
    equal(state.emailStatus, "failed");
    equal(state.error, "provider_rejected");
  });
});
