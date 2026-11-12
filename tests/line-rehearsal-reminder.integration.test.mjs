import { strictEqual } from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { deleteApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const emulatorProjectId = "seisakuboard-conflict-test";
const date = "2026-11-15";
let db;
let service;
let lineHelpers;
let messaging;

async function clearData() {
  if (!db) return;
  await Promise.all(["projects", "userIntegrations", "lineUserLinks", "lineNotificationDeliveries"]
    .map((name) => db.recursiveDelete(db.collection(name))));
}

async function setupProject({ cancelled = false } = {}) {
  const project = db.collection("projects").doc("project-a");
  await project.set({ name: "第61回公演" });
  await Promise.all([
    project.collection("rehearsals").doc("r1").set({
      startAt: Timestamp.fromDate(new Date(`${date}T13:00:00+09:00`)),
      endAt: Timestamp.fromDate(new Date(`${date}T17:00:00+09:00`)),
      type: "acting", customType: "", venue: "会議室A", cancelled,
    }),
    project.collection("rehearsals").doc("r2").set({
      startAt: Timestamp.fromDate(new Date(`${date}T15:00:00+09:00`)),
      endAt: Timestamp.fromDate(new Date(`${date}T18:00:00+09:00`)),
      type: "stage_combat", customType: "", venue: "体育室", cancelled,
    }),
  ]);
  return project;
}

async function addPerson(project, id, uid, displayName, lineSuffix, attendance) {
  await Promise.all([
    project.collection("people").doc(id).set({ displayName, linkedUserUid: uid, active: true, attendanceTarget: true }),
    project.collection("participants").doc(id).set({ displayName: `${displayName}-旧`, linkedUserUid: uid, active: true }),
    project.collection("participantLinkedUsers").doc(uid).set({ participantId: id }),
  ]);
  if (lineSuffix) {
    const lineUserId = `U${lineSuffix.repeat(32)}`;
    await db.collection("userIntegrations").doc(uid).collection("providers").doc("line").set({
      provider: "line", status: "linked", lineUserId, deliveryStatus: "unknown",
    });
    await db.collection("lineUserLinks").doc(lineHelpers.getLineUserLinkId(lineUserId)).set({ uid, lineUserId });
  }
  if (attendance) {
    await project.collection("attendanceRecords").doc(`${date}_${id}`).set({ participantId: id, date, ...attendance });
  }
}

before(async () => {
  process.env.GCLOUD_PROJECT = emulatorProjectId;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = emulatorProjectId;
  service = await import("../lib/server/line-rehearsal-reminder.ts");
  lineHelpers = await import("../lib/line-account-link.ts");
  messaging = await import("../lib/server/line-messaging.ts");
  db = getFirestore();
});

beforeEach(clearData);
after(async () => {
  await clearData();
  await Promise.all(getApps().map((app) => deleteApp(app)));
});

describe("LINE rehearsal day-before reminder", () => {
  it("sends one combined message to linked attending, absent and unanswered participants", async () => {
    const project = await setupProject();
    await addPerson(project, "attending", "uid-attending", "田中", "a", { status: "attending", availableFrom: "14:00", availableUntil: "18:00" });
    await addPerson(project, "absent", "uid-absent", "鈴木", "b", { status: "absent", availableFrom: null, availableUntil: null });
    await addPerson(project, "unanswered", "uid-unanswered", "佐藤", "c", null);
    await addPerson(project, "tentative", "uid-tentative", "伊藤", "e", { status: "tentative", availableFrom: null, availableUntil: null });
    await addPerson(project, "early", "uid-early", "高橋", "d", { status: "attending", availableFrom: "13:00", availableUntil: "16:00" });
    await addPerson(project, "unlinked", "uid-unlinked", "未連携", null, null);
    const messages = [];
    const result = await service.runLineRehearsalReminderForDate({
      date, projectId: project.id, db,
      send: async (payload) => messages.push(payload),
    });
    strictEqual(result.rehearsalCount, 2);
    strictEqual(result.participantCount, 6);
    strictEqual(result.linkedCount, 5);
    strictEqual(result.unlinkedCount, 1);
    strictEqual(result.sentCount, 5);
    strictEqual(messages.length, 5);
    strictEqual(messages[0].text.includes("■ 芝居"), true);
    strictEqual(messages[0].text.includes("■ 殺陣"), true);
    strictEqual(messages[0].text.includes("田中（14:00頃から）"), true);
    strictEqual(messages[0].text.includes("高橋（16:00頃まで）"), true);
    strictEqual(messages[0].text.includes("欠席：\n・鈴木"), true);
    strictEqual(messages[0].text.includes("未定：\n・伊藤"), true);
    strictEqual(messages[0].text.includes("未回答：\n・佐藤"), true);
    strictEqual(messages[0].text.includes("出席予定："), false);
    strictEqual(messages[0].text.includes("出欠は当日全体の予定です（部門別ではありません）"), true);
    strictEqual(messages[0].text.includes("-旧"), false);
  });

  it("does not send when the project has no rehearsal on the target date", async () => {
    const project = db.collection("projects").doc("project-empty");
    await project.set({ name: "稽古なし公演" });
    await addPerson(project, "person", "uid-person", "田中", "a", null);
    let calls = 0;
    const result = await service.runLineRehearsalReminderForDate({
      date, projectId: project.id, db, send: async () => { calls += 1; },
    });
    strictEqual(result.targetProjectCount, 0);
    strictEqual(result.rehearsalCount, 0);
    strictEqual(result.sentCount, 0);
    strictEqual(calls, 0);
  });

  it("is idempotent across reruns and dry-run never sends or writes", async () => {
    const project = await setupProject();
    await addPerson(project, "person", "uid-person", "田中", "a", { status: "attending", availableFrom: "13:00", availableUntil: "18:00" });
    let calls = 0;
    const send = async () => { calls += 1; };
    const first = await service.runLineRehearsalReminderForDate({ date, projectId: project.id, db, send });
    const second = await service.runLineRehearsalReminderForDate({ date, projectId: project.id, db, send });
    strictEqual(first.sentCount, 1);
    strictEqual(second.sentCount, 0);
    strictEqual(second.duplicateExcludedCount, 1);
    strictEqual(calls, 1);
    await clearData();
    const dryProject = await setupProject();
    await addPerson(dryProject, "person", "uid-person", "田中", "a", null);
    const dry = await service.runLineRehearsalReminderForDate({ date, projectId: dryProject.id, db, dryRun: true, send });
    strictEqual(dry.recipientCount, 1);
    strictEqual(calls, 1);
    strictEqual((await db.collection("lineNotificationDeliveries").get()).empty, true);
  });

  it("does not send when every rehearsal is cancelled", async () => {
    const project = await setupProject({ cancelled: true });
    await addPerson(project, "person", "uid-person", "田中", "a", null);
    let calls = 0;
    const result = await service.runLineRehearsalReminderForDate({ date, projectId: project.id, db, send: async () => { calls += 1; } });
    strictEqual(result.targetProjectCount, 0);
    strictEqual(result.cancelledExcludedCount, 2);
    strictEqual(calls, 0);
    strictEqual((await db.collection("lineNotificationDeliveries").get()).empty, true);
  });

  it("stores retryable and permanent failures without unlinking LINE identity", async () => {
    const project = await setupProject();
    await addPerson(project, "person", "uid-person", "田中", "a", null);
    await service.runLineRehearsalReminderForDate({
      date, projectId: project.id, db,
      send: async () => { throw new messaging.LineMessagingError("line_server_error", 503, 500); },
    });
    let delivery = (await db.collection("lineNotificationDeliveries").get()).docs[0];
    strictEqual(delivery.data().status, "failed_retryable");
    const retryKey = delivery.data().retryKey;
    strictEqual(typeof retryKey, "string");
    strictEqual((await db.collection("userIntegrations").doc("uid-person").collection("providers").doc("line").get()).exists, true);
    await delivery.ref.update({ nextAttemptAt: Timestamp.fromMillis(0), attemptCount: 2 });
    await service.retryDueLineRehearsalReminders({
      db, now: Timestamp.now(),
      send: async () => { throw new messaging.LineMessagingError("line_server_error", 503, 500); },
    });
    delivery = await delivery.ref.get();
    strictEqual(delivery.data().status, "failed_permanent");
    strictEqual(delivery.data().attemptCount, 3);
    strictEqual(delivery.data().retryKey, retryKey);
  });
});
