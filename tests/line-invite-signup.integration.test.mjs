import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "line-signup-project";
const ownerUid = "line-signup-owner";
let db; let inviteService; let authService; let signupService; let accountService; let handlerModule;

function projectRef() { return db.collection("projects").doc(projectId); }
function tokenFrom(url) { return new URLSearchParams(new URL(url).hash.slice(1)).get("token"); }
function fakeAuth(options = {}) {
  const users = new Map();
  return {
    users,
    async createUser(input) {
      if (options.failBeforeCreate) throw new Error("create failed");
      const record = { ...input, providerData: [] }; users.set(input.uid, record);
      if (options.afterCreate) await options.afterCreate(input);
      if (options.unknownAfterCreate) throw new Error("unknown result");
      return record;
    },
    async getUser(uid) {
      if (users.has(uid)) return users.get(uid);
      const error = new Error("not found"); error.code = "auth/user-not-found"; throw error;
    },
    async deleteUser(uid) { users.delete(uid); },
  };
}
async function seed() {
  await projectRef().set({ title: "LINE招待公演", memberUids: [ownerUid] });
  await projectRef().collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", displayName: "Owner" });
  await projectRef().collection("people").doc("person-a").set({
    displayName: "参加者A", active: true, attendanceTarget: true,
    specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: null,
    publicNote: "", createdByUid: ownerUid, updatedByUid: ownerUid,
  });
}
async function clear() {
  for (const name of ["lineSignupAttempts", "lineSignupLocks", "lineAuthStates", "lineAuthTickets", "lineUserLinks", "userIntegrations", "projectInviteLinks", "projects"]) {
    await db.recursiveDelete(db.collection(name));
  }
}
async function begin(personId, lineUserId = `U${"a".repeat(32)}`) {
  const created = await inviteService.createProjectInviteLink({ uid: ownerUid, projectId, ...(personId ? { personId } : {}), appOrigin: "https://app.test" });
  const raw = tokenFrom(created.url);
  const state = await authService.createLineAuthState(raw);
  const result = await authService.completeLineAuthState({ state: state.state, lineUserId, displayName: "LINE利用者", photoURL: "https://example.test/photo.png" });
  return { created, raw, result, lineUserId };
}
async function beginThroughHttp(personId, lineUserId = `U${"2".repeat(32)}`) {
  const created = await inviteService.createProjectInviteLink({
    uid: ownerUid,
    projectId,
    ...(personId ? { personId } : {}),
    appOrigin: "https://app.test",
  });
  const raw = tokenFrom(created.url);
  const start = handlerModule.createLineAuthStartHandler({
    createState: authService.createLineAuthState,
    getConfig: () => ({ channelId: "channel-a", redirectUri: "https://app.test/api/line/auth/callback" }),
    logError: () => undefined,
    logDiagnostic: () => undefined,
  });
  const started = await start(new Request("https://app.test/api/line/auth/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ startMode: "invite", inviteToken: raw }),
  }));
  strictEqual(started.status, 200);
  const state = new URL((await started.json()).redirectUrl).searchParams.get("state");
  const saved = await authService.readLineAuthState(state);
  strictEqual(saved.inviteId, created.invite.id);

  const callback = handlerModule.createLineAuthCallbackHandler({
    readState: authService.readLineAuthState,
    failState: authService.failLineAuthState,
    exchangeCode: async () => ({ accessToken: "access-a", idToken: "id-a" }),
    verifyIdToken: async () => ({ lineUserId, displayName: "LINE利用者" }),
    completeState: authService.completeLineAuthState,
    getConfig: () => ({
      appOrigin: "https://app.test",
      channelId: "channel-a",
      channelSecret: "secret-a",
      redirectUri: "https://app.test/api/line/auth/callback",
    }),
    logError: () => undefined,
    logDiagnostic: () => undefined,
  });
  const completed = await callback(new Request(
    `https://app.test/api/line/auth/callback?code=code-a&state=${state}&friendship_status_changed=true`
  ));
  return { created, raw, state, completed };
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId; process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  inviteService = await import("../lib/server/project-invite-links.ts");
  authService = await import("../lib/server/line-auth.ts");
  signupService = await import("../lib/server/line-invite-signup.ts");
  accountService = await import("../lib/server/line-account-link.ts");
  handlerModule = await import("../lib/server/line-auth-handler.ts");
  db = getFirestore();
});
beforeEach(async () => { await clear(); await seed(); });
after(async () => { await clear(); await Promise.all(getApps().map((app) => deleteApp(app))); });

describe("LINE invite-only signup", () => {
  it("binds general and person-specific invite starts through HTTP and continues after the friend option", async () => {
    for (const personId of [undefined, "person-a"]) {
      const started = await beginThroughHttp(personId);
      const location = new URL(started.completed.headers.get("location"));
      strictEqual(location.searchParams.get("result"), "signup");
      strictEqual(Boolean(new URLSearchParams(location.hash.slice(1)).get("signup")), true);
    }
  });

  it("keeps normal and invite states isolated when both are pending", async () => {
    const normal = await authService.createLineAuthState();
    const invite = await inviteService.createProjectInviteLink({ uid: ownerUid, projectId, appOrigin: "https://app.test" });
    const invited = await authService.createLineAuthState(tokenFrom(invite.url));
    const normalResult = await authService.completeLineAuthState({ state: normal.state, lineUserId: `U${"3".repeat(32)}` });
    const inviteResult = await authService.completeLineAuthState({ state: invited.state, lineUserId: `U${"4".repeat(32)}` });
    strictEqual(normalResult.outcome, "not_linked");
    strictEqual(inviteResult.outcome, "signup_required");
  });

  it("reports expired, revoked, used, and missing invites without falling back to unlinked", async () => {
    for (const [mutation, outcome] of [
      [{ expiresAt: Timestamp.fromMillis(Date.now() - 1) }, "invite_expired"],
      [{ status: "revoked" }, "invite_revoked"],
      [{ status: "claimed", claimedByUid: "other" }, "invite_used"],
      [null, "invite_unavailable"],
    ]) {
      const created = await inviteService.createProjectInviteLink({ uid: ownerUid, projectId, appOrigin: "https://app.test" });
      const state = await authService.createLineAuthState(tokenFrom(created.url));
      const reference = db.collection("projectInviteLinks").doc(created.invite.id);
      if (mutation) await reference.update(mutation); else await reference.delete();
      const result = await authService.completeLineAuthState({ state: state.state, lineUserId: `U${"5".repeat(32)}` });
      strictEqual(result.outcome, outcome);
      strictEqual(result.outcome === "not_linked", false);
    }
  });

  it("creates a LINE-only user and joins a general invite as viewer", async () => {
    const started = await begin(); strictEqual(started.result.outcome, "signup_required");
    const auth = fakeAuth(); const completed = await signupService.completeLineInviteSignup(started.result.signupToken, auth);
    const member = await projectRef().collection("members").doc([...auth.users.keys()][0]).get();
    strictEqual(member.data().role, "viewer"); strictEqual(member.data().email, undefined);
    strictEqual((await db.collection("projectInviteLinks").doc(started.created.invite.id).get()).data().status, "claimed");
    strictEqual((await db.collection("lineAuthTickets").get()).size, 1); strictEqual(completed.projectId, projectId);
  });

  it("atomically links a designated person for immediate attendance identity", async () => {
    const started = await begin("person-a"); const auth = fakeAuth();
    const preview = await signupService.previewLineInviteSignup(started.result.signupToken);
    strictEqual(preview.personName, "参加者A");
    strictEqual(preview.projectName, "LINE招待公演");
    strictEqual(preview.existingAccountRequired, false);
    await signupService.completeLineInviteSignup(started.result.signupToken, auth);
    const uid = [...auth.users.keys()][0];
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, uid);
    strictEqual((await projectRef().collection("participants").doc("person-a").get()).data().linkedUserUid, uid);
    strictEqual((await projectRef().collection("participantLinkedUsers").doc(uid).get()).data().participantId, "person-a");
    const events = await projectRef().collection("lineLinkEvents").get();
    strictEqual(events.size, 1);
    strictEqual(events.docs[0].data().lineDisplayName, "LINE利用者");
  });

  it("requires existing-account verification before creating a user for an already linked person", async () => {
    const existingUid = "existing-google-user";
    await projectRef().collection("people").doc("person-a").update({ linkedUserUid: existingUid });
    const started = await begin("person-a", `U${"9".repeat(32)}`);
    const preview = await signupService.previewLineInviteSignup(started.result.signupToken);
    strictEqual(preview.personName, "参加者A");
    strictEqual(preview.existingAccountRequired, true);
    const auth = fakeAuth();
    await rejects(
      () => signupService.completeLineInviteSignup(started.result.signupToken, auth),
      (error) => error?.code === "existing_account_required",
    );
    strictEqual(auth.users.size, 0);
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, existingUid);
    strictEqual((await db.collection("projectInviteLinks").doc(started.created.invite.id).get()).data().status, "pending");
  });

  it("does not offer signup without an invite and keeps an existing LINE mapping on its original uid", async () => {
    const state = await authService.createLineAuthState();
    strictEqual((await authService.completeLineAuthState({ state: state.state, lineUserId: `U${"b".repeat(32)}` })).outcome, "not_linked");
    const linkedUid = "existing-firebase-user"; const linkedLine = `U${"c".repeat(32)}`;
    await db.runTransaction(async (transaction) => accountService.linkFirebaseUserToLineUserInTransaction(transaction, { uid: linkedUid, lineUserId: linkedLine, now: Timestamp.now() }));
    const invite = await inviteService.createProjectInviteLink({ uid: ownerUid, projectId, appOrigin: "https://app.test" });
    const linkedState = await authService.createLineAuthState(tokenFrom(invite.url));
    const result = await authService.completeLineAuthState({ state: linkedState.state, lineUserId: linkedLine });
    strictEqual(result.outcome, "ticket_created"); strictEqual((await db.collection("lineSignupAttempts").get()).empty, true);
  });

  it("rejects expired, revoked, and already claimed invitations before OAuth signup", async () => {
    for (const mutation of [
      { expiresAt: Timestamp.fromMillis(Date.now() - 1) },
      { status: "revoked" },
      { status: "claimed", claimedByUid: "other" },
    ]) {
      const created = await inviteService.createProjectInviteLink({ uid: ownerUid, projectId, appOrigin: "https://app.test" });
      await db.collection("projectInviteLinks").doc(created.invite.id).update(mutation);
      await rejects(() => authService.createLineAuthState(tokenFrom(created.url)));
    }
  });

  it("serializes concurrent signup for the same LINE identity and invite", async () => {
    const first = await begin(undefined, `U${"d".repeat(32)}`);
    const secondState = await authService.createLineAuthState(first.raw);
    const second = await authService.completeLineAuthState({ state: secondState.state, lineUserId: first.lineUserId });
    const auth = fakeAuth();
    const results = await Promise.allSettled([
      signupService.completeLineInviteSignup(first.result.signupToken, auth),
      signupService.completeLineInviteSignup(second.signupToken, auth),
    ]);
    strictEqual(results.filter((result) => result.status === "fulfilled").length, 1);
    strictEqual(auth.users.size, 1);
  });

  it("releases the invite before user creation failure and recovers an unknown createUser result", async () => {
    const failed = await begin(); const failingAuth = fakeAuth({ failBeforeCreate: true });
    await rejects(() => signupService.completeLineInviteSignup(failed.result.signupToken, failingAuth));
    strictEqual((await db.collection("projectInviteLinks").doc(failed.created.invite.id).get()).data().status, "pending");
    const recovered = await begin(undefined, `U${"e".repeat(32)}`); const uncertainAuth = fakeAuth({ unknownAfterCreate: true });
    await signupService.completeLineInviteSignup(recovered.result.signupToken, uncertainAuth);
    strictEqual(uncertainAuth.users.size, 1);
  });

  it("does not overwrite a person linked during signup and compensates the new Auth user", async () => {
    const started = await begin("person-a", `U${"f".repeat(32)}`);
    await projectRef().collection("people").doc("person-a").update({ linkedUserUid: "other-user" });
    const auth = fakeAuth();
    await rejects(() => signupService.completeLineInviteSignup(started.result.signupToken, auth));
    strictEqual(auth.users.size, 0);
    strictEqual((await db.collection("projectInviteLinks").doc(started.created.invite.id).get()).data().status, "pending");
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, "other-user");
  });

  it("preserves a competing LINE link and compensates only the uncommitted Auth user", async () => {
    const started = await begin(undefined, `U${"1".repeat(32)}`);
    const competingUid = "existing-linked-user";
    const auth = fakeAuth({
      afterCreate: async () => {
        await db.runTransaction(async (transaction) => accountService.linkFirebaseUserToLineUserInTransaction(
          transaction,
          { uid: competingUid, lineUserId: started.lineUserId, now: Timestamp.now() },
        ));
      },
    });
    await rejects(() => signupService.completeLineInviteSignup(started.result.signupToken, auth));
    strictEqual(auth.users.size, 0);
    const reverseDocuments = await db.collection("lineUserLinks").get();
    strictEqual(reverseDocuments.size, 1);
    strictEqual(reverseDocuments.docs[0].data().uid, competingUid);
    strictEqual((await db.collection("projectInviteLinks").doc(started.created.invite.id).get()).data().status, "pending");
  });
});
