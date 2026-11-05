import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const uidA = "line-link-user-a";
const uidB = "line-link-user-b";
const lineA = `U${"a".repeat(32)}`;
const lineB = `U${"b".repeat(32)}`;
let service;
let helpers;
let db;

function integrationRef(uid) {
  return db.collection("userIntegrations").doc(uid).collection("providers").doc("line");
}

function reverseRef(lineUserId) {
  return db.collection("lineUserLinks").doc(helpers.getLineUserLinkId(lineUserId));
}

function nonceRef(nonce) {
  return db.collection("lineAccountLinkNonces").doc(helpers.getLineAccountLinkNonceId(nonce));
}

async function createNonce(uid) {
  return service.createLineAccountLinkNonce(uid);
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
  service = await import("../lib/server/line-account-link.ts");
  db = getFirestore();
});

beforeEach(clearData);

after(async () => {
  await clearData();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("LINE account link server transactions", () => {
  it("stores only a hash document ID for a ten-minute pending nonce", async () => {
    const before = Date.now();
    const nonce = await createNonce(uidA);
    const snapshot = await nonceRef(nonce).get();

    strictEqual(snapshot.exists, true);
    strictEqual(snapshot.id === nonce, false);
    strictEqual(snapshot.data().uid, uidA);
    strictEqual(snapshot.data().status, "pending");
    strictEqual(snapshot.data().consumedAt, null);
    const ttl = snapshot.data().expiresAt.toMillis() - snapshot.data().createdAt.toMillis();
    strictEqual(ttl, helpers.LINE_ACCOUNT_LINK_NONCE_TTL_MS);
    strictEqual(snapshot.data().createdAt.toMillis() >= before, true);
  });

  it("links an unlinked pair, consumes the nonce, and rejects nonce reuse", async () => {
    const nonce = await createNonce(uidA);
    const result = await service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce });

    strictEqual(result.outcome, "linked");
    strictEqual((await integrationRef(uidA).get()).data().lineUserId, lineA);
    strictEqual((await integrationRef(uidA).get()).data().deliveryStatus, "unknown");
    strictEqual((await reverseRef(lineA).get()).data().uid, uidA);
    strictEqual((await nonceRef(nonce).get()).data().status, "consumed");
    await rejects(
      () => service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce }),
      (error) => error.code === "nonce_not_pending"
    );
  });

  it("rejects and fails an expired nonce without creating either link", async () => {
    const nonce = await createNonce(uidA);
    await nonceRef(nonce).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });

    await rejects(
      () => service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce }),
      (error) => error.code === "nonce_expired"
    );
    strictEqual((await nonceRef(nonce).get()).data().status, "failed");
    strictEqual((await integrationRef(uidA).get()).exists, false);
    strictEqual((await reverseRef(lineA).get()).exists, false);
  });

  it("treats a complete existing pair as idempotent with a fresh nonce", async () => {
    const first = await createNonce(uidA);
    await service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce: first });
    const linkedAt = (await integrationRef(uidA).get()).data().linkedAt.toMillis();
    const second = await createNonce(uidA);
    const result = await service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce: second });

    strictEqual(result.outcome, "already_linked");
    strictEqual((await integrationRef(uidA).get()).data().linkedAt.toMillis(), linkedAt);
    strictEqual((await nonceRef(second).get()).data().status, "consumed");
  });

  it("rejects an already-linked UID and an already-linked LINE user without overwriting", async () => {
    await service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce: await createNonce(uidA) });

    const uidConflictNonce = await createNonce(uidA);
    await rejects(
      () => service.linkLineAccount({ uid: uidA, lineUserId: lineB, nonce: uidConflictNonce }),
      (error) => error.code === "uid_already_linked"
    );
    const lineConflictNonce = await createNonce(uidB);
    await rejects(
      () => service.linkLineAccount({ uid: uidB, lineUserId: lineA, nonce: lineConflictNonce }),
      (error) => error.code === "line_user_already_linked"
    );

    strictEqual((await integrationRef(uidA).get()).data().lineUserId, lineA);
    strictEqual((await integrationRef(uidB).get()).exists, false);
    strictEqual((await reverseRef(lineA).get()).data().uid, uidA);
    strictEqual((await reverseRef(lineB).get()).exists, false);
  });

  it("unlinks a consistent pair, is safe when absent, and rejects a partial pair", async () => {
    await service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce: await createNonce(uidA) });
    strictEqual((await service.unlinkLineAccount(uidA)).outcome, "unlinked");
    strictEqual((await integrationRef(uidA).get()).exists, false);
    strictEqual((await reverseRef(lineA).get()).exists, false);
    strictEqual((await service.unlinkLineAccount(uidA)).outcome, "already_unlinked");

    const now = Timestamp.now();
    await integrationRef(uidA).set({
      provider: "line",
      lineUserId: lineA,
      status: "linked",
      deliveryStatus: "unknown",
      linkedAt: now,
      updatedAt: now,
      lastFollowAt: null,
      lastUnfollowAt: null,
    });
    await rejects(
      () => service.unlinkLineAccount(uidA),
      (error) => error.code === "line_link_inconsistent"
    );
    strictEqual((await integrationRef(uidA).get()).exists, true);
  });

  it("updates delivery status for a linked pair and ignores an unknown LINE user", async () => {
    await service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce: await createNonce(uidA) });
    strictEqual((await service.updateLineDeliveryStatus({ lineUserId: lineA, event: "follow" })).outcome, "updated");
    let data = (await integrationRef(uidA).get()).data();
    strictEqual(data.deliveryStatus, "reachable");
    strictEqual(data.lastFollowAt instanceof Timestamp, true);

    strictEqual((await service.updateLineDeliveryStatus({ lineUserId: lineA, event: "unfollow" })).outcome, "updated");
    data = (await integrationRef(uidA).get()).data();
    strictEqual(data.deliveryStatus, "unreachable");
    strictEqual(data.lastUnfollowAt instanceof Timestamp, true);
    strictEqual((await service.updateLineDeliveryStatus({ lineUserId: lineB, event: "follow" })).outcome, "not_linked");
  });

  it("serializes concurrent attempts to claim the same LINE user", async () => {
    const [nonceA, nonceB] = await Promise.all([createNonce(uidA), createNonce(uidB)]);
    const results = await Promise.allSettled([
      service.linkLineAccount({ uid: uidA, lineUserId: lineA, nonce: nonceA }),
      service.linkLineAccount({ uid: uidB, lineUserId: lineA, nonce: nonceB }),
    ]);

    strictEqual(results.filter(({ status }) => status === "fulfilled").length, 1);
    strictEqual(results.filter(({ status }) => status === "rejected").length, 1);
    const reverse = await reverseRef(lineA).get();
    strictEqual(reverse.exists, true);
    const linkedUid = reverse.data().uid;
    strictEqual((await integrationRef(linkedUid).get()).data().lineUserId, lineA);
  });
});
