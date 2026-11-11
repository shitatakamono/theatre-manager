import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const primaryUid = "merge-primary";
const secondaryUid = "merge-secondary";
let db;
let service;
let lineHelpers;

function user(uid, providers) {
  return {
    uid,
    disabled: false,
    email: providers.includes("google.com") ? `${uid}@example.invalid` : undefined,
    displayName: "Test User",
    photoURL: undefined,
    providerData: providers.map((providerId) => ({ providerId })),
    metadata: { creationTime: "Mon, 01 Jan 2024 00:00:00 GMT", lastSignInTime: "Mon, 01 Jan 2024 00:00:00 GMT" },
  };
}

const auth = {
  async getUser(uid) {
    if (uid === primaryUid) return user(uid, ["google.com"]);
    if (uid === secondaryUid) return user(uid, ["custom"]);
    throw new Error("not found");
  },
};

async function clearData() {
  if (!db) return;
  await Promise.all([
    "projects", "userIntegrations", "lineUserLinks", "lineAuthStates", "lineLoginStates", "lineAuthTickets",
    "lineSignupAttempts", "googleCalendarOAuthStates", "googleCalendarConnections",
    "googleCalendarSyncJobs", "projectInviteLinks", "lineNotificationDeliveries",
    "accountMergeAttempts", "accountMergeLocks",
    "futureActiveData",
  ].map((name) => db.recursiveDelete(db.collection(name))));
}

async function createProject(id = "project-a", primaryRole = null, secondaryRole = "viewer") {
  const memberUids = [primaryRole ? primaryUid : null, secondaryRole ? secondaryUid : null].filter(Boolean);
  const project = db.collection("projects").doc(id);
  await project.set({ name: id, memberUids });
  if (primaryRole) await project.collection("members").doc(primaryUid).set({ uid: primaryUid, role: primaryRole, displayName: "Primary" });
  if (secondaryRole) await project.collection("members").doc(secondaryUid).set({ uid: secondaryUid, role: secondaryRole, displayName: "Secondary" });
  return project;
}

async function linkLine(uid, lineUserId) {
  await db.collection("userIntegrations").doc(uid).collection("providers").doc("line").set({ provider: "line", status: "linked", lineUserId });
  await db.collection("lineUserLinks").doc(lineHelpers.getLineUserLinkId(lineUserId)).set({ uid, lineUserId });
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  service = await import("../lib/server/account-merge.ts");
  lineHelpers = await import("../lib/line-account-link.ts");
  db = getFirestore();
});

beforeEach(clearData);
after(async () => {
  await clearData();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("account merge inventory and dry-run", () => {
  it("builds a safe plan for primary Google and secondary LINE-only membership", async () => {
    const project = await createProject();
    await project.collection("tasks").doc("task-a").set({ assigneeUid: secondaryUid });
    await linkLine(secondaryUid, `U${"a".repeat(32)}`);
    const result = await service.createAccountMergeDryRun({ primaryUid, secondaryUid, initiatedByUid: "internal-operator", db, auth });
    strictEqual(result.assessment.classification, "safe");
    strictEqual(result.assessment.plan.some((item) => item.action === "move_secondary_membership"), true);
    strictEqual(result.assessment.plan.some((item) => item.action === "move_secondary_line_link"), true);
    const attempt = await db.collection("accountMergeAttempts").doc(result.attemptId).get();
    strictEqual(attempt.data().status, "ready");
    strictEqual(attempt.data().inventoryHash.length, 43);
    strictEqual((await db.collection("accountMergeLocks").get()).empty, true);
  });

  it("requires review for role conflicts", async () => {
    await createProject("project-a", "viewer", "editor");
    const inventory = await service.collectAccountMergeInventory({ primaryUid, secondaryUid, db, auth });
    const { assessAccountMerge } = await import("../lib/account-merge.ts");
    strictEqual(assessAccountMerge(inventory).classification, "needs_review");
  });

  it("blocks different linked people and preserves history-only references", async () => {
    const project = await createProject("project-a", "viewer", "viewer");
    await project.collection("people").doc("person-a").set({ linkedUserUid: primaryUid });
    await project.collection("people").doc("person-b").set({ linkedUserUid: secondaryUid });
    await project.collection("activityLogs").doc("history").set({ actorUid: secondaryUid, createdByUid: secondaryUid });
    const inventory = await service.collectAccountMergeInventory({ primaryUid, secondaryUid, db, auth });
    const { assessAccountMerge } = await import("../lib/account-merge.ts");
    strictEqual(inventory.unknownActiveReferences.length, 0);
    strictEqual(assessAccountMerge(inventory).classification, "blocked");
  });

  it("classifies two LINE identities and two Calendar connections for review", async () => {
    await linkLine(primaryUid, `U${"a".repeat(32)}`);
    await linkLine(secondaryUid, `U${"b".repeat(32)}`);
    await db.collection("googleCalendarConnections").doc(primaryUid).set({ connected: true });
    await db.collection("googleCalendarConnections").doc(secondaryUid).set({ connected: true });
    const inventory = await service.collectAccountMergeInventory({ primaryUid, secondaryUid, db, auth });
    const { assessAccountMerge } = await import("../lib/account-merge.ts");
    strictEqual(assessAccountMerge(inventory).classification, "needs_review");
  });

  it("blocks an active signup and an unknown active UID field", async () => {
    const project = await createProject();
    const now = Timestamp.now();
    await db.collection("lineSignupAttempts").doc("signup").set({ plannedUid: secondaryUid, status: "creating", expiresAt: Timestamp.fromMillis(now.toMillis() + 60_000) });
    await project.collection("mysteryActiveData").doc("mystery").set({ ownerUid: secondaryUid });
    await db.collection("futureActiveData").doc("mystery").set({ subjectUid: secondaryUid });
    const inventory = await service.collectAccountMergeInventory({ primaryUid, secondaryUid, db, auth });
    const { assessAccountMerge } = await import("../lib/account-merge.ts");
    const assessment = assessAccountMerge(inventory);
    strictEqual(assessment.classification, "blocked");
    strictEqual(assessment.findings.some((item) => item.code === "ACTIVE_SIGNUP"), true);
    strictEqual(assessment.findings.some((item) => item.code === "UNKNOWN_ACTIVE_REFERENCE"), true);
    strictEqual(inventory.unknownActiveReferences.includes("futureActiveData.subjectUid"), true);
  });

  it("blocks active LINE authentication and invite claiming without requiring a uid on the state", async () => {
    const now = Timestamp.now();
    await db.collection("lineAuthStates").doc("pending-auth").set({
      status: "pending", expiresAt: Timestamp.fromMillis(now.toMillis() + 60_000),
    });
    await db.collection("projectInviteLinks").doc("claiming-invite").set({
      status: "claiming", expiresAt: Timestamp.fromMillis(now.toMillis() + 60_000),
    });
    const inventory = await service.collectAccountMergeInventory({ primaryUid, secondaryUid, db, auth });
    const { assessAccountMerge } = await import("../lib/account-merge.ts");
    const assessment = assessAccountMerge(inventory);
    strictEqual(inventory.active.lineAuth, 1);
    strictEqual(inventory.active.inviteClaim, 1);
    strictEqual(assessment.findings.some((item) => item.code === "ACTIVE_LINE_AUTH"), true);
    strictEqual(assessment.findings.some((item) => item.code === "ACTIVE_INVITE_CLAIM"), true);
  });

  it("blocks an orphan LINE reverse mapping and treats notification recipient uid as history", async () => {
    const lineUserId = `U${"c".repeat(32)}`;
    await db.collection("lineUserLinks").doc(lineHelpers.getLineUserLinkId(lineUserId)).set({
      uid: secondaryUid, lineUserId,
    });
    await db.collection("lineNotificationDeliveries").doc("delivery").set({ recipientUid: secondaryUid });
    const inventory = await service.collectAccountMergeInventory({ primaryUid, secondaryUid, db, auth });
    const { assessAccountMerge } = await import("../lib/account-merge.ts");
    const assessment = assessAccountMerge(inventory);
    strictEqual(inventory.unknownActiveReferences.includes("lineNotificationDeliveries.recipientUid"), false);
    strictEqual(assessment.findings.some((item) => item.code === "LINE_MAPPING_CONFLICT"), true);
  });

  it("does not permanently block expired states", async () => {
    await db.collection("lineLoginStates").doc("expired").set({ uid: secondaryUid, status: "pending", expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    const inventory = await service.collectAccountMergeInventory({ primaryUid, secondaryUid, db, auth });
    strictEqual(inventory.active.lineAuth, 0);
  });

  it("rejects a concurrent lock and allows reuse after release", async () => {
    await service.acquireAccountMergeLocks(db, { attemptId: "first", primaryUid, secondaryUid });
    await rejects(
      () => service.acquireAccountMergeLocks(db, { attemptId: "second", primaryUid, secondaryUid }),
      (error) => error instanceof service.AccountMergeError && error.code === "merge_locked"
    );
    await service.releaseAccountMergeLocks(db, "first", [primaryUid, secondaryUid]);
    await service.acquireAccountMergeLocks(db, { attemptId: "second", primaryUid, secondaryUid });
    await service.releaseAccountMergeLocks(db, "second", [primaryUid, secondaryUid]);
  });

  it("allows both uid locks to be reacquired after their lease expires", async () => {
    await service.acquireAccountMergeLocks(db, { attemptId: "expired", primaryUid, secondaryUid });
    const expiredAt = Timestamp.fromMillis(Date.now() - 1);
    await Promise.all([primaryUid, secondaryUid].map((uid) => db.collection("accountMergeLocks").doc(uid).update({ expiresAt: expiredAt })));
    await service.acquireAccountMergeLocks(db, { attemptId: "replacement", primaryUid, secondaryUid });
    strictEqual((await db.collection("accountMergeLocks").doc(primaryUid).get()).data().attemptId, "replacement");
    strictEqual((await db.collection("accountMergeLocks").doc(secondaryUid).get()).data().attemptId, "replacement");
    await service.releaseAccountMergeLocks(db, "replacement", [primaryUid, secondaryUid]);
  });
});
