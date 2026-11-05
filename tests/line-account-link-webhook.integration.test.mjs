import { strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const uidA = "line-webhook-user-a";
const uidB = "line-webhook-user-b";
const lineA = `U${"c".repeat(32)}`;
const lineB = `U${"d".repeat(32)}`;
let linkService;
let webhookService;
let helpers;
let db;

function context(overrides = {}) {
  return {
    accountLinkEvents: [],
    followUserIds: [],
    unfollowUserIds: [],
    ...overrides,
  };
}

function integrationRef(uid) {
  return db.collection("userIntegrations").doc(uid).collection("providers").doc("line");
}

function reverseRef(lineUserId) {
  return db.collection("lineUserLinks").doc(helpers.getLineUserLinkId(lineUserId));
}

function nonceRef(nonce) {
  return db.collection("lineAccountLinkNonces").doc(helpers.getLineAccountLinkNonceId(nonce));
}

async function clearData() {
  if (!db) return;
  await Promise.all([
    db.recursiveDelete(db.collection("userIntegrations")),
    db.recursiveDelete(db.collection("lineUserLinks")),
    db.recursiveDelete(db.collection("lineAccountLinkNonces")),
  ]);
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  helpers = await import("../lib/line-account-link.ts");
  linkService = await import("../lib/server/line-account-link.ts");
  webhookService = await import("../lib/server/line-account-link-webhook.ts");
  db = getFirestore();
});

beforeEach(clearData);

after(async () => {
  await clearData();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("LINE accountLink webhook Firestore integration", () => {
  it("links a pending nonce and treats the same signed event replay as idempotent", async () => {
    const nonce = await linkService.createLineAccountLinkNonce(uidA);
    const webhookContext = context({
      accountLinkEvents: [{ result: "ok", lineUserId: lineA, nonce }],
    });
    const first = await webhookService.processLineAccountLinkWebhook(webhookContext);
    const replay = await webhookService.processLineAccountLinkWebhook(webhookContext);

    strictEqual(first.linkedCount, 1);
    strictEqual(replay.idempotentCount, 1);
    strictEqual((await nonceRef(nonce).get()).data().status, "consumed");
    strictEqual((await integrationRef(uidA).get()).data().lineUserId, lineA);
    strictEqual((await reverseRef(lineA).get()).data().uid, uidA);
  });

  it("does not overwrite links for consumed-nonce or different-UID conflicts", async () => {
    const nonceA = await linkService.createLineAccountLinkNonce(uidA);
    await webhookService.processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "ok", lineUserId: lineA, nonce: nonceA }],
    }));
    const consumedConflict = await webhookService.processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "ok", lineUserId: lineB, nonce: nonceA }],
    }));

    const nonceB = await linkService.createLineAccountLinkNonce(uidB);
    const uidConflict = await webhookService.processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "ok", lineUserId: lineA, nonce: nonceB }],
    }));

    strictEqual(consumedConflict.ignoredBusinessErrorCount, 1);
    strictEqual(uidConflict.ignoredBusinessErrorCount, 1);
    strictEqual((await integrationRef(uidA).get()).data().lineUserId, lineA);
    strictEqual((await integrationRef(uidB).get()).exists, false);
    strictEqual((await reverseRef(lineA).get()).data().uid, uidA);
    strictEqual((await reverseRef(lineB).get()).exists, false);
  });

  it("fails expired and explicit failed nonces without creating links", async () => {
    const expired = await linkService.createLineAccountLinkNonce(uidA);
    await nonceRef(expired).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    const expiredResult = await webhookService.processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "ok", lineUserId: lineA, nonce: expired }],
    }));

    const failed = await linkService.createLineAccountLinkNonce(uidB);
    const failedResult = await webhookService.processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "failed", nonce: failed }],
    }));
    const reuse = await webhookService.processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "ok", lineUserId: lineB, nonce: failed }],
    }));

    strictEqual(expiredResult.ignoredBusinessErrorCount, 1);
    strictEqual(failedResult.failedNonceCount, 1);
    strictEqual(reuse.ignoredBusinessErrorCount, 1);
    strictEqual((await nonceRef(expired).get()).data().status, "failed");
    strictEqual((await nonceRef(failed).get()).data().status, "failed");
    strictEqual((await integrationRef(uidA).get()).exists, false);
    strictEqual((await integrationRef(uidB).get()).exists, false);
  });

  it("updates delivery state without deleting identity and ignores unknown users", async () => {
    const nonce = await linkService.createLineAccountLinkNonce(uidA);
    await webhookService.processLineAccountLinkWebhook(context({
      accountLinkEvents: [{ result: "ok", lineUserId: lineA, nonce }],
    }));
    await webhookService.processLineAccountLinkWebhook(context({ followUserIds: [lineA, lineB] }));
    let integration = (await integrationRef(uidA).get()).data();
    strictEqual(integration.deliveryStatus, "reachable");
    strictEqual(integration.lastFollowAt instanceof Timestamp, true);

    await webhookService.processLineAccountLinkWebhook(context({ unfollowUserIds: [lineA] }));
    integration = (await integrationRef(uidA).get()).data();
    strictEqual(integration.deliveryStatus, "unreachable");
    strictEqual(integration.lastUnfollowAt instanceof Timestamp, true);
    strictEqual((await reverseRef(lineA).get()).data().uid, uidA);
    strictEqual((await reverseRef(lineB).get()).exists, false);
  });
});
