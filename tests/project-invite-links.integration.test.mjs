import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const projectId = "invite-link-project";
const ownerUid = "invite-owner";
const editorUid = "invite-editor";
const viewerUid = "invite-viewer";
let db;
let service;

function projectRef() { return db.collection("projects").doc(projectId); }
function rawToken(url) { return new URLSearchParams(new URL(url).hash.slice(1)).get("token"); }

async function seed() {
  await projectRef().set({ title: "招待テスト公演", memberUids: [ownerUid, editorUid, viewerUid] });
  await Promise.all([
    projectRef().collection("members").doc(ownerUid).set({ uid: ownerUid, role: "owner", displayName: "Owner" }),
    projectRef().collection("members").doc(editorUid).set({ uid: editorUid, role: "editor", displayName: "Editor" }),
    projectRef().collection("members").doc(viewerUid).set({ uid: viewerUid, role: "viewer", displayName: "Viewer" }),
    projectRef().collection("people").doc("person-a").set({ displayName: "参加者A", active: true, attendanceTarget: true, specialPractice: "none", rehearsalParticipationTypes: ["acting"], linkedUserUid: null, publicNote: "", createdByUid: ownerUid, updatedByUid: ownerUid }),
  ]);
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  service = await import("../lib/server/project-invite-links.ts");
  db = getFirestore();
});
beforeEach(async () => { await db.recursiveDelete(db.collection("projectInviteLinks")); await db.recursiveDelete(db.collection("projects")); await seed(); });
after(async () => { await db.recursiveDelete(db.collection("projectInviteLinks")); await db.recursiveDelete(db.collection("projects")); await Promise.all(getApps().map((app) => deleteApp(app))); });

describe("project invite link transactions", () => {
  it("allows only owner creation and stores only hash, viewer role, and seven-day expiry", async () => {
    const created = await service.createProjectInviteLink({ uid: ownerUid, projectId, appOrigin: "https://app.test" });
    const token = rawToken(created.url); const stored = await db.collection("projectInviteLinks").doc(created.invite.id).get();
    strictEqual(Boolean(token), true); strictEqual(stored.exists, true); strictEqual(stored.data().role, "viewer"); strictEqual(stored.data().token, undefined);
    strictEqual(stored.data().expiresAt.toMillis() - stored.data().createdAt.toMillis(), 7 * 24 * 60 * 60 * 1000);
    await rejects(() => service.createProjectInviteLink({ uid: editorUid, projectId, appOrigin: "https://app.test" }), (error) => error.code === "forbidden");
    await rejects(() => service.createProjectInviteLink({ uid: viewerUid, projectId, appOrigin: "https://app.test" }), (error) => error.code === "forbidden");
  });

  it("claims a general invite atomically and is idempotent only for the same uid", async () => {
    const created = await service.createProjectInviteLink({ uid: ownerUid, projectId, appOrigin: "https://app.test" }); const token = rawToken(created.url);
    const result = await service.claimProjectInviteLink({ uid: "new-user", displayName: "新規利用者", email: "new@example.test", rawToken: token });
    strictEqual(result.outcome, "claimed"); strictEqual((await projectRef().get()).data().memberUids.includes("new-user"), true);
    strictEqual((await projectRef().collection("members").doc("new-user").get()).data().role, "viewer");
    strictEqual((await db.collection("projectInviteLinks").doc(created.invite.id).get()).data().status, "claimed");
    strictEqual((await service.claimProjectInviteLink({ uid: "new-user", rawToken: token })).outcome, "already_claimed");
    await rejects(() => service.claimProjectInviteLink({ uid: "other-user", rawToken: token }), (error) => error.code === "invite_used");
  });

  it("links a designated person through the existing people, participants, and reverse structures", async () => {
    const created = await service.createProjectInviteLink({ uid: ownerUid, projectId, personId: "person-a", appOrigin: "https://app.test" });
    const result = await service.claimProjectInviteLink({ uid: "person-user", displayName: "参加者A", rawToken: rawToken(created.url) });
    strictEqual(result.personLinked, true);
    strictEqual((await projectRef().collection("people").doc("person-a").get()).data().linkedUserUid, "person-user");
    strictEqual((await projectRef().collection("participants").doc("person-a").get()).data().linkedUserUid, "person-user");
    strictEqual((await projectRef().collection("participantLinkedUsers").doc("person-user").get()).data().participantId, "person-a");
  });

  it("rejects missing, inactive, cross-project and conflicting people without claiming", async () => {
    await rejects(() => service.createProjectInviteLink({ uid: ownerUid, projectId, personId: "missing", appOrigin: "https://app.test" }), (error) => error.code === "person_not_found");
    await projectRef().collection("people").doc("person-a").update({ active: false });
    await rejects(() => service.createProjectInviteLink({ uid: ownerUid, projectId, personId: "person-a", appOrigin: "https://app.test" }), (error) => error.code === "person_not_found");
    await projectRef().collection("people").doc("person-a").update({ active: true, linkedUserUid: "other-user" });
    const created = await service.createProjectInviteLink({ uid: ownerUid, projectId, personId: "person-a", appOrigin: "https://app.test" });
    await rejects(() => service.claimProjectInviteLink({ uid: "new-user", rawToken: rawToken(created.url) }), (error) => error.code === "person_link_conflict");
    strictEqual((await db.collection("projectInviteLinks").doc(created.invite.id).get()).data().status, "pending");
  });

  it("rejects expired and revoked links and allows owner revoke only while pending", async () => {
    const expired = await service.createProjectInviteLink({ uid: ownerUid, projectId, appOrigin: "https://app.test" });
    await db.collection("projectInviteLinks").doc(expired.invite.id).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    await rejects(() => service.claimProjectInviteLink({ uid: "new-user", rawToken: rawToken(expired.url) }), (error) => error.code === "invite_expired");
    const revoked = await service.createProjectInviteLink({ uid: ownerUid, projectId, appOrigin: "https://app.test" });
    await service.revokeProjectInviteLink({ uid: ownerUid, projectId, inviteId: revoked.invite.id });
    await rejects(() => service.claimProjectInviteLink({ uid: "new-user", rawToken: rawToken(revoked.url) }), (error) => error.code === "invite_unavailable");
  });
});
