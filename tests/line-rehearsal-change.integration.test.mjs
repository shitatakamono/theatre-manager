import { strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const projectId = "seisakuboard-conflict-test";
let db; let service; let links; let reminder; let messaging;
async function clearData() { for (const name of ["projects", "userIntegrations", "lineUserLinks", "lineNotificationDeliveries", "rehearsalChangeNotificationEvents", "rehearsalChangeNotificationBatches"]) await db.recursiveDelete(db.collection(name)); }
const raw = (venue = "大原", extra = {}) => ({ startAt: Timestamp.fromDate(new Date("2026-11-15T13:00:00+09:00")), endAt: Timestamp.fromDate(new Date("2026-11-15T17:00:00+09:00")), type: "acting", customType: "", venue, content: "通し", note: "", ...extra });
async function recipient(uid = "uid-a") {
  const project = db.collection("projects").doc("project-a"); const person = "person-a"; const lineUserId = `U${"a".repeat(32)}`;
  await Promise.all([
    project.set({ name: "公演" }), project.collection("people").doc(person).set({ displayName: "参加者", active: true, attendanceTarget: true, linkedUserUid: uid }),
    project.collection("participantLinkedUsers").doc(uid).set({ participantId: person }),
    db.collection("userIntegrations").doc(uid).collection("providers").doc("line").set({ provider: "line", status: "linked", lineUserId }),
    db.collection("lineUserLinks").doc(links.getLineUserLinkId(lineUserId)).set({ uid, lineUserId }),
  ]);
}
before(async () => {
  process.env.GCLOUD_PROJECT = projectId; process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = projectId;
  service = await import("../lib/server/line-rehearsal-change.ts");
  links = await import("../lib/line-account-link.ts");
  reminder = await import("../lib/line-rehearsal-reminder.ts");
  messaging = await import("../lib/server/line-messaging.ts");
  db = getFirestore();
});
beforeEach(clearData); after(async () => { await clearData(); await Promise.all(getApps().map(deleteApp)); });

describe("LINE rehearsal change batching", () => {
  it("records visible future changes, ignores internal-only changes, batches and is idempotent", async () => {
    const occurred = Timestamp.fromDate(new Date("2026-11-15T10:00:00+09:00"));
    strictEqual(await service.recordRehearsalChangeNotificationEvent({ eventId: "internal", projectId: "project-a", rehearsalId: "r1", eventType: "updated", before: raw(), after: { ...raw(), revision: 2 }, now: occurred, db }), false);
    strictEqual(await service.recordRehearsalChangeNotificationEvent({ eventId: "visible", projectId: "project-a", rehearsalId: "r1", eventType: "updated", before: raw(), after: raw("海風"), now: occurred, db }), true);
    await recipient(); let sends = 0;
    const input = { slot: "12", cutoff: new Date("2026-11-15T12:00:00+09:00"), db, send: async () => { sends += 1; } };
    const first = await service.runRehearsalChangeNotifications(input); const second = await service.runRehearsalChangeNotifications(input);
    strictEqual(first.sentCount, 1); strictEqual(second.sentCount, 0); strictEqual(sends, 1);
    strictEqual((await db.collection("rehearsalChangeNotificationEvents").get()).docs[0].data().status, "processed");
  });

  it("collapses reverted and create-delete events without sending", async () => {
    const occurred = Timestamp.fromDate(new Date("2026-11-15T10:00:00+09:00"));
    await service.recordRehearsalChangeNotificationEvent({ eventId: "a", projectId: "project-a", rehearsalId: "r1", eventType: "updated", before: raw(), after: raw("海風"), now: occurred, db });
    await service.recordRehearsalChangeNotificationEvent({ eventId: "b", projectId: "project-a", rehearsalId: "r1", eventType: "updated", before: raw("海風"), after: raw(), now: Timestamp.fromMillis(occurred.toMillis() + 1), db });
    await service.recordRehearsalChangeNotificationEvent({ eventId: "c", projectId: "project-a", rehearsalId: "r2", eventType: "created", after: raw(), now: Timestamp.fromMillis(occurred.toMillis() + 2), db });
    await service.recordRehearsalChangeNotificationEvent({ eventId: "d", projectId: "project-a", rehearsalId: "r2", eventType: "deleted", before: raw(), now: Timestamp.fromMillis(occurred.toMillis() + 3), db });
    let sends = 0; const result = await service.runRehearsalChangeNotifications({ slot: "12", cutoff: new Date("2026-11-15T12:00:00+09:00"), db, send: async () => { sends += 1; } });
    strictEqual(result.noopCount, 2); strictEqual(sends, 0);
    strictEqual((await db.collection("rehearsalChangeNotificationEvents").where("status", "==", "processed").get()).size, 4);
  });

  it("dry-run does not send or mutate events", async () => {
    const occurred = Timestamp.fromDate(new Date("2026-11-15T10:00:00+09:00"));
    await service.recordRehearsalChangeNotificationEvent({ eventId: "dry", projectId: "project-a", rehearsalId: "r1", eventType: "created", after: raw(), now: occurred, db }); await recipient();
    let sends = 0; const result = await service.runRehearsalChangeNotifications({ slot: "12", cutoff: new Date("2026-11-15T12:00:00+09:00"), db, dryRun: true, send: async () => { sends += 1; } });
    strictEqual(result.recipientCount, 1); strictEqual(sends, 0); strictEqual((await db.collection("lineNotificationDeliveries").get()).empty, true);
    strictEqual((await db.collection("rehearsalChangeNotificationEvents").get()).docs[0].data().status, "pending");
  });

  it("retries transient failures with the same delivery and converges once", async () => {
    const occurred = Timestamp.fromDate(new Date("2026-11-15T10:00:00+09:00"));
    await service.recordRehearsalChangeNotificationEvent({ eventId: "retry", projectId: "project-a", rehearsalId: "r1", eventType: "updated", before: raw(), after: raw("海風"), now: occurred, db }); await recipient();
    await service.runRehearsalChangeNotifications({ slot: "12", cutoff: new Date("2026-11-15T12:00:00+09:00"), db, send: async () => { throw new messaging.LineMessagingError("line_server_error", 503, 500); } });
    const delivery = (await db.collection("lineNotificationDeliveries").get()).docs[0]; const retryKey = delivery.data().retryKey;
    strictEqual(delivery.data().status, "failed_retryable");
    await service.runRehearsalChangeNotifications({ slot: "12", cutoff: new Date("2026-11-15T12:00:00+09:00"), db, send: async () => { throw new Error("not due"); } });
    strictEqual((await db.collection("rehearsalChangeNotificationBatches").get()).docs[0].data().status, "retry");
    await delivery.ref.update({ nextAttemptAt: Timestamp.fromMillis(0) });
    let sends = 0; await service.retryRehearsalChangeNotifications({ db, send: async (payload) => { sends += 1; strictEqual(payload.retryKey, retryKey); } });
    strictEqual(sends, 1); strictEqual((await delivery.ref.get()).data().status, "sent");
    strictEqual((await db.collection("rehearsalChangeNotificationBatches").get()).docs[0].data().status, "completed");
  });

  it("suppresses only when the same recipient has an explicit sent day-before delivery", async () => {
    const occurred = Timestamp.fromDate(new Date("2026-11-15T10:00:00+09:00"));
    const tomorrow = raw("海風", { startAt: Timestamp.fromDate(new Date("2026-11-16T13:00:00+09:00")), endAt: Timestamp.fromDate(new Date("2026-11-16T17:00:00+09:00")) });
    await service.recordRehearsalChangeNotificationEvent({ eventId: "suppressed", projectId: "project-a", rehearsalId: "r1", eventType: "created", after: tomorrow, now: occurred, db }); await recipient();
    await db.collection("lineNotificationDeliveries").doc(reminder.buildLineReminderDeliveryId("project-a", "2026-11-16", "uid-a")).set({ status: "sent" });
    let sends = 0; const result = await service.runRehearsalChangeNotifications({ slot: "12", cutoff: new Date("2026-11-15T12:00:00+09:00"), db, send: async () => { sends += 1; } });
    strictEqual(result.suppressedCount, 1); strictEqual(sends, 0);
  });
});
