import { rejects, strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const uid = "existing-line-auth-user";
const lineUserId = `U${"c".repeat(32)}`;
let db;
let accountLink;
let authPrimitives;
let authService;
let authHandler;
let loginService;

function stateRef(state) {
  return db.collection("lineAuthStates").doc(authPrimitives.getLineAuthStateId(state));
}

function ticketRef(ticket) {
  return db.collection("lineAuthTickets").doc(authPrimitives.getLineAuthTicketId(ticket));
}

async function clearData() {
  if (!db) return;
  await Promise.all([
    db.recursiveDelete(db.collection("userIntegrations")),
    db.recursiveDelete(db.collection("lineUserLinks")),
    db.recursiveDelete(db.collection("lineLoginStates")),
    db.recursiveDelete(db.collection("lineAuthStates")),
    db.recursiveDelete(db.collection("lineAuthTickets")),
    db.recursiveDelete(db.collection("projects")),
    db.recursiveDelete(db.collection("googleCalendarConnections")),
  ]);
}

async function establishExistingLink() {
  const temporary = await loginService.createLineLoginState(uid);
  await loginService.completeLineLoginState({ state: temporary.state, lineUserId, deliveryStatus: "reachable" });
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  accountLink = await import("../lib/line-account-link.ts");
  authPrimitives = await import("../lib/line-auth.ts");
  authService = await import("../lib/server/line-auth.ts");
  authHandler = await import("../lib/server/line-auth-handler.ts");
  loginService = await import("../lib/server/line-login.ts");
  db = getFirestore();
});

beforeEach(clearData);
after(async () => {
  await clearData();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("LINE authentication server transactions", () => {
  it("stores hashed state without a uid and issues a one-use ticket for an existing link", async () => {
    await establishExistingLink();
    await db.collection("projects").doc("project-a").set({ memberUids: [uid] });
    await db.collection("projects").doc("project-a").collection("members").doc(uid).set({ uid, role: "viewer" });
    await db.collection("projects").doc("project-a").collection("people").doc("person-a").set({
      displayName: "参加者A", linkedUserUid: uid,
    });
    const temporary = await authService.createLineAuthState();
    const storedState = await stateRef(temporary.state).get();
    strictEqual(storedState.exists, true);
    strictEqual(storedState.id === temporary.state, false);
    strictEqual(storedState.data().uid, undefined);
    strictEqual(storedState.data().expiresAt.toMillis() - storedState.data().createdAt.toMillis(), authPrimitives.LINE_AUTH_STATE_TTL_MS);

    const completed = await authService.completeLineAuthState({ state: temporary.state, lineUserId });
    strictEqual(completed.outcome, "ticket_created");
    const storedTicket = await ticketRef(completed.ticket).get();
    strictEqual(storedTicket.id === completed.ticket, false);
    strictEqual(storedTicket.data().uid, uid);
    strictEqual(storedTicket.data().expiresAt.toMillis() - storedTicket.data().createdAt.toMillis(), authPrimitives.LINE_AUTH_TICKET_TTL_MS);
    strictEqual((await db.collection("projects").doc("project-a").collection("lineLinkEvents").get()).empty, true);
    strictEqual(await authService.consumeLineAuthTicket(completed.ticket), uid);
    await rejects(() => authService.consumeLineAuthTicket(completed.ticket), (error) => error.code === "ticket_not_pending");
  });

  it("does not create a ticket or Firebase identity for an unlinked LINE user", async () => {
    const temporary = await authService.createLineAuthState();
    const result = await authService.completeLineAuthState({ state: temporary.state, lineUserId });
    strictEqual(result.outcome, "not_linked");
    strictEqual((await db.collection("lineAuthTickets").get()).empty, true);
    strictEqual((await db.collection("lineUserLinks").doc(accountLink.getLineUserLinkId(lineUserId)).get()).exists, false);
  });

  it("exchanges a linked user's ticket for a custom token using only the mapped uid", async () => {
    await establishExistingLink();
    const temporary = await authService.createLineAuthState();
    const completed = await authService.completeLineAuthState({ state: temporary.state, lineUserId });
    const calls = [];
    const handler = authHandler.createLineAuthExchangeHandler({
      consumeTicket: authService.consumeLineAuthTicket,
      getUser: async (targetUid) => { calls.push(["user", targetUid]); return {}; },
      createCustomToken: async (targetUid) => { calls.push(["token", targetUid]); return "custom-token"; },
      logError: () => undefined,
    });
    const response = await handler(new Request("https://app.example/api/line/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: completed.ticket, uid: "forged-uid", lineUserId: "forged-line" }),
    }));
    strictEqual(response.status, 200);
    strictEqual((await response.json()).customToken, "custom-token");
    strictEqual(calls[0][1], uid);
    strictEqual(calls[1][1], uid);
  });

  it("rejects expired state and ticket values", async () => {
    await establishExistingLink();
    const expiredState = await authService.createLineAuthState();
    await stateRef(expiredState.state).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    await rejects(() => authService.readLineAuthState(expiredState.state), (error) => error.code === "state_expired");
    strictEqual((await stateRef(expiredState.state).get()).data().status, "failed");

    const validState = await authService.createLineAuthState();
    const completed = await authService.completeLineAuthState({ state: validState.state, lineUserId });
    await ticketRef(completed.ticket).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1) });
    await rejects(() => authService.consumeLineAuthTicket(completed.ticket), (error) => error.code === "ticket_expired");
    strictEqual((await ticketRef(completed.ticket).get()).data().status, "failed");
  });

  it("serializes concurrent ticket consumption and leaves project data untouched", async () => {
    await establishExistingLink();
    await db.collection("projects").doc("project-a").set({ memberUids: [uid], marker: "unchanged" });
    await db.collection("googleCalendarConnections").doc(uid).set({ connected: true, marker: "unchanged" });
    const temporary = await authService.createLineAuthState();
    const completed = await authService.completeLineAuthState({ state: temporary.state, lineUserId });
    const results = await Promise.allSettled([
      authService.consumeLineAuthTicket(completed.ticket),
      authService.consumeLineAuthTicket(completed.ticket),
    ]);
    strictEqual(results.filter((result) => result.status === "fulfilled").length, 1);
    strictEqual(results.filter((result) => result.status === "rejected").length, 1);
    strictEqual((await db.collection("projects").doc("project-a").get()).data().marker, "unchanged");
    strictEqual((await db.collection("googleCalendarConnections").doc(uid).get()).data().marker, "unchanged");
  });
});
