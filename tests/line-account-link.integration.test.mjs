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
let lineLoginHelpers;
let lineLoginService;
let lineDeliveryService;
let db;

function integrationRef(uid) {
  return db.collection("userIntegrations").doc(uid).collection("providers").doc("line");
}

function reverseRef(lineUserId) {
  return db.collection("lineUserLinks").doc(helpers.getLineUserLinkId(lineUserId));
}

function loginStateRef(state) {
  return db.collection("lineLoginStates").doc(lineLoginHelpers.getLineLoginStateId(state));
}

async function linkWithLineLogin(uid, lineUserId, deliveryStatus = "unknown") {
  const temporary = await lineLoginService.createLineLoginState(uid);
  return lineLoginService.completeLineLoginState({
    state: temporary.state,
    lineUserId,
    deliveryStatus,
  });
}

async function clearData() {
  if (!db) return;
  await Promise.all([
    db.recursiveDelete(db.collection("userIntegrations")),
    db.recursiveDelete(db.collection("lineUserLinks")),
    db.recursiveDelete(db.collection("lineLoginStates")),
  ]);
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  helpers = await import("../lib/line-account-link.ts");
  lineLoginHelpers = await import("../lib/line-login.ts");
  service = await import("../lib/server/line-account-link.ts");
  lineLoginService = await import("../lib/server/line-login.ts");
  lineDeliveryService = await import("../lib/server/line-delivery-webhook.ts");
  db = getFirestore();
});

beforeEach(clearData);

after(async () => {
  await clearData();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("LINE Login server transactions", () => {
  it("stores a hashed ten-minute state and atomically completes the shared link pair", async () => {
    const temporary = await lineLoginService.createLineLoginState(uidA);
    const state = await loginStateRef(temporary.state).get();
    strictEqual(state.exists, true);
    strictEqual(state.id === temporary.state, false);
    strictEqual(state.data().status, "pending");
    strictEqual(state.data().expiresAt.toMillis() - state.data().createdAt.toMillis(), lineLoginHelpers.LINE_LOGIN_STATE_TTL_MS);

    const result = await lineLoginService.completeLineLoginState({
      state: temporary.state,
      lineUserId: lineA,
      lineDisplayName: "LINE表示名",
      deliveryStatus: "reachable",
    });
    strictEqual(result.outcome, "linked");
    strictEqual((await integrationRef(uidA).get()).data().deliveryStatus, "reachable");
    strictEqual((await integrationRef(uidA).get()).data().lineDisplayName, "LINE表示名");
    strictEqual((await reverseRef(lineA).get()).data().uid, uidA);
    strictEqual((await loginStateRef(temporary.state).get()).data().status, "consumed");
  });

  it("is idempotent for the same pair and rejects UID or LINE conflicts without overwrite", async () => {
    const first = await lineLoginService.createLineLoginState(uidA);
    await lineLoginService.completeLineLoginState({ state: first.state, lineUserId: lineA, deliveryStatus: "unknown" });
    strictEqual((await lineLoginService.completeLineLoginState({ state: first.state, lineUserId: lineA, deliveryStatus: "reachable" })).outcome, "already_linked");

    const uidConflict = await lineLoginService.createLineLoginState(uidA);
    await rejects(
      () => lineLoginService.completeLineLoginState({ state: uidConflict.state, lineUserId: lineB, deliveryStatus: "unknown" }),
      (error) => error.code === "uid_already_linked"
    );
    const lineConflict = await lineLoginService.createLineLoginState(uidB);
    await rejects(
      () => lineLoginService.completeLineLoginState({ state: lineConflict.state, lineUserId: lineA, deliveryStatus: "unknown" }),
      (error) => error.code === "line_user_already_linked"
    );
    strictEqual((await integrationRef(uidA).get()).data().lineUserId, lineA);
    strictEqual((await integrationRef(uidB).get()).exists, false);
  });

  it("fails expired states and never creates a link", async () => {
    const temporary = await lineLoginService.createLineLoginState(uidA);
    await loginStateRef(temporary.state).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    await rejects(() => lineLoginService.readLineLoginState(temporary.state), (error) => error.code === "state_expired");
    strictEqual((await loginStateRef(temporary.state).get()).data().status, "failed");
    strictEqual((await integrationRef(uidA).get()).exists, false);
  });

  it("serializes concurrent attempts to link the same LINE user", async () => {
    const [stateA, stateB] = await Promise.all([
      lineLoginService.createLineLoginState(uidA),
      lineLoginService.createLineLoginState(uidB),
    ]);
    const results = await Promise.allSettled([
      lineLoginService.completeLineLoginState({ state: stateA.state, lineUserId: lineA, deliveryStatus: "unknown" }),
      lineLoginService.completeLineLoginState({ state: stateB.state, lineUserId: lineA, deliveryStatus: "unknown" }),
    ]);
    strictEqual(results.filter(({ status }) => status === "fulfilled").length, 1);
    strictEqual(results.filter(({ status }) => status === "rejected").length, 1);
  });
});

describe("shared LINE identity transactions", () => {
  it("unlinks a consistent pair and is idempotent when both sides are absent", async () => {
    await linkWithLineLogin(uidA, lineA);
    strictEqual((await service.unlinkLineAccount(uidA)).outcome, "unlinked");
    strictEqual((await integrationRef(uidA).get()).exists, false);
    strictEqual((await reverseRef(lineA).get()).exists, false);
    strictEqual((await service.unlinkLineAccount(uidA)).outcome, "already_unlinked");
  });

  it("rejects UID-only, reverse-only, and mismatched pairs without deleting data", async () => {
    const now = Timestamp.now();
    const integrationData = {
      provider: "line",
      lineUserId: lineA,
      status: "linked",
      deliveryStatus: "unknown",
      linkedAt: now,
      updatedAt: now,
      lastFollowAt: null,
      lastUnfollowAt: null,
    };
    await integrationRef(uidA).set(integrationData);
    await rejects(() => service.unlinkLineAccount(uidA), (error) => error.code === "line_link_inconsistent");
    strictEqual((await integrationRef(uidA).get()).exists, true);

    await clearData();
    await reverseRef(lineA).set({ uid: uidA, lineUserId: lineA, linkedAt: now, updatedAt: now });
    await rejects(() => service.unlinkLineAccount(uidA), (error) => error.code === "line_link_inconsistent");
    strictEqual((await reverseRef(lineA).get()).exists, true);

    await clearData();
    await integrationRef(uidA).set(integrationData);
    await reverseRef(lineA).set({ uid: uidB, lineUserId: lineA, linkedAt: now, updatedAt: now });
    await rejects(() => service.unlinkLineAccount(uidA), (error) => error.code === "line_link_inconsistent");
    strictEqual((await integrationRef(uidA).get()).exists, true);
    strictEqual((await reverseRef(lineA).get()).data().uid, uidB);
  });

  it("updates delivery status while preserving the identity pair", async () => {
    await linkWithLineLogin(uidA, lineA);
    strictEqual((await lineDeliveryService.processLineDeliveryWebhook({
      followUserIds: [lineA, lineB],
      unfollowUserIds: [],
    })).deliveryUpdatedCount, 1);
    let data = (await integrationRef(uidA).get()).data();
    strictEqual(data.deliveryStatus, "reachable");
    strictEqual(data.lastFollowAt instanceof Timestamp, true);

    strictEqual((await lineDeliveryService.processLineDeliveryWebhook({
      followUserIds: [],
      unfollowUserIds: [lineA],
    })).deliveryUpdatedCount, 1);
    data = (await integrationRef(uidA).get()).data();
    strictEqual(data.deliveryStatus, "unreachable");
    strictEqual(data.lastUnfollowAt instanceof Timestamp, true);
    strictEqual((await reverseRef(lineA).get()).data().uid, uidA);
    strictEqual((await reverseRef(lineB).get()).exists, false);
  });
});
