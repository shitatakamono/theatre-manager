import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  aggregateRehearsalChangeEvents,
  buildRehearsalChangeBatchId,
  buildRehearsalChangeDeliveryId,
  buildRehearsalChangeMessages,
  canSuppressWithDayBeforeDelivery,
  extractRehearsalChangeSnapshot,
  getRehearsalChangeBatchWindow,
  shouldRecordRehearsalChange,
  type RehearsalChangeEvent,
  type RehearsalChangeSnapshot,
} from "../line-rehearsal-change.ts";
import { buildLineReminderDeliveryId, classifyLineReminderFailure, getNextTokyoDate, LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS } from "../line-rehearsal-reminder.ts";
import { adminDb } from "./firebase-admin.ts";
import { LineMessagingError, sendLinePushTextMessage } from "./line-messaging.ts";
import { loadLineReminderPeople, loadLineReminderRecipients } from "./line-rehearsal-reminder.ts";

const EVENT_COLLECTION = "rehearsalChangeNotificationEvents";
const BATCH_COLLECTION = "rehearsalChangeNotificationBatches";
const DELIVERY_COLLECTION = "lineNotificationDeliveries";
const LEASE_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;

type Sender = (input: { lineUserId: string; text: string; retryKey: string }) => Promise<void>;
type Slot = "12" | "20";

export type RehearsalChangeRunSummary = {
  eventCount: number;
  projectCount: number;
  batchCount: number;
  rehearsalCount: number;
  noopCount: number;
  recipientCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  retryCount: number;
  suppressedCount: number;
  messagePreviews: string[];
};

function emptySummary(): RehearsalChangeRunSummary {
  return { eventCount: 0, projectCount: 0, batchCount: 0, rehearsalCount: 0, noopCount: 0, recipientCount: 0, sentCount: 0, skippedCount: 0, failedCount: 0, retryCount: 0, suppressedCount: 0, messagePreviews: [] };
}

function asMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function snapshotFromStored(value: unknown): RehearsalChangeSnapshot | null {
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.startAtMillis !== "number" || typeof data.typeLabel !== "string") return null;
  return data as RehearsalChangeSnapshot;
}

export async function recordRehearsalChangeNotificationEvent(input: {
  eventId: string;
  projectId: string;
  rehearsalId: string;
  eventType: "created" | "updated" | "deleted";
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  now?: Timestamp;
  db?: Firestore;
}): Promise<boolean> {
  const db = input.db ?? adminDb;
  const now = input.now ?? Timestamp.now();
  const before = extractRehearsalChangeSnapshot(input.before);
  const after = extractRehearsalChangeSnapshot(input.after);
  if (!shouldRecordRehearsalChange({ before, after, occurredAtMillis: now.toMillis() })) return false;
  const id = createHash("sha256").update(input.eventId).digest("base64url");
  await db.collection(EVENT_COLLECTION).doc(id).set({
    projectId: input.projectId,
    rehearsalId: input.rehearsalId,
    eventType: input.eventType,
    before,
    after,
    occurredAt: now,
    status: "pending",
    batchId: null,
    processedAt: null,
    createdAt: now,
  });
  return true;
}

async function claimBatch(input: {
  db: Firestore;
  batchId: string;
  projectId: string;
  windowStart: Timestamp;
  windowEnd: Timestamp;
  eventIds: string[];
  messages: string[];
  recipientUids: string[];
  rehearsalCount: number;
  now: Timestamp;
}) {
  const reference = input.db.collection(BATCH_COLLECTION).doc(input.batchId);
  const operationId = randomBytes(18).toString("base64url");
  return input.db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const data = current.data();
    if (data?.status === "completed") return null;
    if (data?.status === "processing" && (asMillis(data.leaseExpiresAt) ?? Number.POSITIVE_INFINITY) > input.now.toMillis()) return null;
    const payload = current.exists ? {} : {
      projectId: input.projectId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      eventIds: input.eventIds,
      messages: input.messages,
      recipientUids: input.recipientUids,
      rehearsalCount: input.rehearsalCount,
      createdAt: input.now,
    };
    transaction.set(reference, { ...payload, status: "processing", operationId, leaseExpiresAt: Timestamp.fromMillis(input.now.toMillis() + LEASE_MS), updatedAt: input.now }, { merge: true });
    return { reference, operationId };
  });
}

async function claimDelivery(db: Firestore, input: { batchId: string; projectId: string; uid: string; now: Timestamp }) {
  const reference = db.collection(DELIVERY_COLLECTION).doc(buildRehearsalChangeDeliveryId(input.batchId, input.uid));
  const operationId = randomBytes(18).toString("base64url");
  return db.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const data = current.data();
    const attempts = Number.isInteger(data?.attemptCount) ? data!.attemptCount : 0;
    if (data?.status === "sent" || data?.status === "failed_permanent" || attempts >= LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS) return null;
    if (data?.status === "sending" && (asMillis(data.leaseExpiresAt) ?? Number.POSITIVE_INFINITY) > input.now.toMillis()) return null;
    if (data?.status === "failed_retryable" && (asMillis(data.nextAttemptAt) ?? 0) > input.now.toMillis()) return null;
    const retryKey = typeof data?.retryKey === "string" ? data.retryKey : randomUUID();
    transaction.set(reference, {
      projectId: input.projectId,
      batchId: input.batchId,
      recipientUid: input.uid,
      notificationType: "rehearsal_schedule_changed",
      status: "sending",
      attemptCount: attempts + 1,
      retryKey,
      operationId,
      leaseExpiresAt: Timestamp.fromMillis(input.now.toMillis() + LEASE_MS),
      createdAt: current.exists ? data?.createdAt ?? input.now : input.now,
      updatedAt: input.now,
      sentAt: data?.sentAt ?? null,
      failedAt: null,
      errorCategory: null,
      nextAttemptAt: null,
    }, { merge: true });
    return { reference, operationId, retryKey, attemptCount: attempts + 1 };
  });
}

async function finishDelivery(db: Firestore, claim: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>, error?: unknown): Promise<"sent" | "retry" | "permanent"> {
  const now = Timestamp.now();
  const code = error instanceof LineMessagingError ? error.code : "line_network_error";
  const status = error ? classifyLineReminderFailure(code, claim.attemptCount) : "sent";
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(claim.reference);
    if (!current.exists || current.data()?.operationId !== claim.operationId) return;
    transaction.update(claim.reference, error ? {
      status, failedAt: now, updatedAt: now, leaseExpiresAt: null, operationId: null, errorCategory: code,
      nextAttemptAt: status === "failed_retryable" ? Timestamp.fromMillis(now.toMillis() + RETRY_DELAY_MS) : null,
    } : { status: "sent", sentAt: now, updatedAt: now, leaseExpiresAt: null, operationId: null, errorCategory: null, nextAttemptAt: null });
  });
  return status === "failed_retryable" ? "retry" : status === "sent" ? "sent" : "permanent";
}

async function finishBatch(input: { db: Firestore; claim: NonNullable<Awaited<ReturnType<typeof claimBatch>>>; eventIds: string[]; retry: boolean }) {
  const now = Timestamp.now();
  await input.db.runTransaction(async (transaction) => {
    const batch = await transaction.get(input.claim.reference);
    if (!batch.exists || batch.data()?.operationId !== input.claim.operationId) return;
    transaction.update(input.claim.reference, { status: input.retry ? "retry" : "completed", operationId: null, leaseExpiresAt: null, updatedAt: now, completedAt: input.retry ? null : now });
    if (!input.retry) for (const id of input.eventIds) transaction.set(input.db.collection(EVENT_COLLECTION).doc(id), { status: "processed", batchId: input.claim.reference.id, processedAt: now }, { merge: true });
  });
}

function storedEvent(document: FirebaseFirestore.QueryDocumentSnapshot): RehearsalChangeEvent | null {
  const data = document.data();
  const occurredAtMillis = asMillis(data.occurredAt);
  if (typeof data.projectId !== "string" || typeof data.rehearsalId !== "string" || occurredAtMillis === null) return null;
  return { id: document.id, projectId: data.projectId, rehearsalId: data.rehearsalId, eventType: data.eventType, before: snapshotFromStored(data.before), after: snapshotFromStored(data.after), occurredAtMillis } as RehearsalChangeEvent;
}

function affectedDates(changes: ReturnType<typeof aggregateRehearsalChangeEvents>): string[] {
  const values = changes.flatMap((change) => [change.before, change.after].flatMap((item) => item ? [new Date(item.startAtMillis + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)] : []));
  return [...new Set(values)];
}

async function processProjectBatch(input: { db: Firestore; projectId: string; events: RehearsalChangeEvent[]; windowStart: Timestamp; windowEnd: Timestamp; windowKey: string; now: Timestamp; dryRun: boolean; send?: Sender; summary: RehearsalChangeRunSummary }) {
  const changes = aggregateRehearsalChangeEvents(input.events);
  input.summary.noopCount += new Set(input.events.map((event) => event.rehearsalId)).size - changes.length;
  if (!changes.length) {
    if (!input.dryRun) {
      const completedAt = Timestamp.now();
      const writes = input.events.map((event) => ({
        reference: input.db.collection(EVENT_COLLECTION).doc(event.id),
      }));
      for (let offset = 0; offset < writes.length; offset += 400) {
        const batch = input.db.batch();
        for (const write of writes.slice(offset, offset + 400)) {
          batch.set(write.reference, { status: "processed", batchId: null, processedAt: completedAt }, { merge: true });
        }
        await batch.commit();
      }
    }
    return;
  }
  const messages = buildRehearsalChangeMessages(changes);
  const people = await loadLineReminderPeople(input.db, input.projectId);
  const recipients = (await loadLineReminderRecipients(input.db, input.projectId, people)).linked;
  const batchId = buildRehearsalChangeBatchId(input.projectId, input.windowKey);
  input.summary.projectCount += 1;
  input.summary.batchCount += 1;
  input.summary.rehearsalCount += changes.length;
  input.summary.messagePreviews.push(...messages);
  if (input.dryRun) { input.summary.recipientCount += recipients.length; return; }
  const claim = await claimBatch({ db: input.db, batchId, projectId: input.projectId, windowStart: input.windowStart, windowEnd: input.windowEnd, eventIds: input.events.map(({ id }) => id), messages, recipientUids: recipients.map(({ uid }) => uid), rehearsalCount: changes.length, now: input.now });
  if (!claim) { input.summary.skippedCount += recipients.length; return; }
  let needsRetry = false;
  const dates = affectedDates(changes);
  const tomorrow = getNextTokyoDate(input.windowEnd.toDate());
  for (const recipient of recipients) {
    const dayBefore = await input.db.collection(DELIVERY_COLLECTION).doc(buildLineReminderDeliveryId(input.projectId, tomorrow, recipient.uid)).get();
    if (canSuppressWithDayBeforeDelivery({ allAffectedDates: dates, tomorrowDate: tomorrow, dayBeforeDeliverySent: dayBefore.data()?.status === "sent" })) {
      input.summary.suppressedCount += 1;
      continue;
    }
    const delivery = await claimDelivery(input.db, { batchId, projectId: input.projectId, uid: recipient.uid, now: input.now });
    if (!delivery) {
      const deliveryStatus = (await input.db.collection(DELIVERY_COLLECTION)
        .doc(buildRehearsalChangeDeliveryId(batchId, recipient.uid)).get()).data()?.status;
      needsRetry ||= deliveryStatus === "failed_retryable" || deliveryStatus === "sending";
      input.summary.skippedCount += 1;
      continue;
    }
    input.summary.recipientCount += 1;
    try {
      await (input.send ?? ((payload) => sendLinePushTextMessage({ ...payload, accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN })) )({ lineUserId: recipient.lineUserId, text: messages[0], retryKey: delivery.retryKey });
      await finishDelivery(input.db, delivery);
      input.summary.sentCount += 1;
    } catch (error) {
      const outcome = await finishDelivery(input.db, delivery, error);
      input.summary.failedCount += 1;
      if (outcome === "retry") { needsRetry = true; input.summary.retryCount += 1; }
    }
  }
  await finishBatch({ db: input.db, claim, eventIds: input.events.map(({ id }) => id), retry: needsRetry });
}

export async function runRehearsalChangeNotifications(input: { slot: Slot; cutoff?: Date; projectId?: string; dryRun?: boolean; db?: Firestore; send?: Sender } ): Promise<RehearsalChangeRunSummary> {
  const db = input.db ?? adminDb;
  const window = getRehearsalChangeBatchWindow({ cutoff: input.cutoff ?? new Date(), slot: input.slot });
  const now = Timestamp.now();
  const snapshot = await db.collection(EVENT_COLLECTION)
    .where("occurredAt", ">", Timestamp.fromMillis(window.startExclusiveMillis))
    .where("occurredAt", "<=", Timestamp.fromMillis(window.endInclusiveMillis))
    .orderBy("occurredAt", "asc").get();
  const events = snapshot.docs.filter((doc) => doc.data().status === "pending").map(storedEvent).filter((event): event is RehearsalChangeEvent => event !== null && (!input.projectId || event.projectId === input.projectId));
  const summary = emptySummary(); summary.eventCount = events.length;
  const groups = new Map<string, RehearsalChangeEvent[]>();
  for (const event of events) groups.set(event.projectId, [...(groups.get(event.projectId) ?? []), event]);
  for (const [projectId, projectEvents] of groups) await processProjectBatch({ db, projectId, events: projectEvents, windowStart: Timestamp.fromMillis(window.startExclusiveMillis), windowEnd: Timestamp.fromMillis(window.endInclusiveMillis), windowKey: window.key, now, dryRun: input.dryRun === true, send: input.send, summary });
  return summary;
}

export async function retryRehearsalChangeNotifications(input: { db?: Firestore; send?: Sender } = {}): Promise<RehearsalChangeRunSummary> {
  const db = input.db ?? adminDb;
  const summary = emptySummary();
  const batches = await db.collection(BATCH_COLLECTION).where("status", "==", "retry").limit(100).get();
  for (const batchDoc of batches.docs) {
    const data = batchDoc.data();
    if (typeof data.projectId !== "string" || !Array.isArray(data.eventIds) || !Array.isArray(data.messages) || !Array.isArray(data.recipientUids)) continue;
    const people = await loadLineReminderPeople(db, data.projectId);
    const recipients = new Map((await loadLineReminderRecipients(db, data.projectId, people)).linked.map((item) => [item.uid, item]));
    const now = Timestamp.now();
    const claim = await claimBatch({ db, batchId: batchDoc.id, projectId: data.projectId, windowStart: data.windowStart, windowEnd: data.windowEnd, eventIds: data.eventIds, messages: data.messages, recipientUids: data.recipientUids, rehearsalCount: data.rehearsalCount ?? 0, now });
    if (!claim) continue;
    let needsRetry = false;
    for (const uid of data.recipientUids as string[]) {
      const recipient = recipients.get(uid); if (!recipient) continue;
      const deliveryReference = db.collection(DELIVERY_COLLECTION).doc(buildRehearsalChangeDeliveryId(batchDoc.id, uid));
      const delivery = await claimDelivery(db, { batchId: batchDoc.id, projectId: data.projectId, uid, now });
      if (!delivery) {
        const status = (await deliveryReference.get()).data()?.status;
        needsRetry ||= status === "failed_retryable" || status === "sending";
        continue;
      }
      try {
        await (input.send ?? ((payload) => sendLinePushTextMessage({ ...payload, accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN })) )({ lineUserId: recipient.lineUserId, text: data.messages[0], retryKey: delivery.retryKey });
        await finishDelivery(db, delivery); summary.sentCount += 1;
      } catch (error) { const outcome = await finishDelivery(db, delivery, error); summary.failedCount += 1; needsRetry ||= outcome === "retry"; }
    }
    await finishBatch({ db, claim, eventIds: data.eventIds, retry: needsRetry });
  }
  return summary;
}
