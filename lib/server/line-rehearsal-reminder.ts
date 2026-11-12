import { randomBytes, randomUUID } from "node:crypto";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import {
  LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS,
  LINE_REHEARSAL_REMINDER_TYPE,
  activeReminderRehearsals,
  buildLineRehearsalReminderMessage,
  buildLineReminderDeliveryId,
  buildReminderAttendanceSummary,
  classifyLineReminderFailure,
  getNextTokyoDate,
  getTokyoDateRange,
  type ReminderAttendance,
  type ReminderPerson,
  type ReminderRehearsal,
} from "../line-rehearsal-reminder.ts";
import { getLineUserLinkId } from "../line-account-link.ts";
import { normalizeStoredRehearsalType, REHEARSAL_TYPE_LABELS } from "../rehearsals.ts";
import { adminDb } from "./firebase-admin.ts";
import { LineMessagingError, sendLinePushTextMessage } from "./line-messaging.ts";

const DELIVERY_COLLECTION = "lineNotificationDeliveries";
const SEND_LEASE_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;

type LineSender = (input: { lineUserId: string; text: string; retryKey: string }) => Promise<void>;

export type LineReminderRunSummary = {
  targetProjectCount: number;
  rehearsalCount: number;
  participantCount: number;
  linkedCount: number;
  unlinkedCount: number;
  recipientCount: number;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  cancelledExcludedCount: number;
  duplicateExcludedCount: number;
  messagePreviews: string[];
};

function emptySummary(): LineReminderRunSummary {
  return {
    targetProjectCount: 0, rehearsalCount: 0, participantCount: 0,
    linkedCount: 0, unlinkedCount: 0, recipientCount: 0,
    sentCount: 0, skippedCount: 0, failedCount: 0,
    cancelledExcludedCount: 0, duplicateExcludedCount: 0, messagePreviews: [],
  };
}

function asMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function typeLabel(data: FirebaseFirestore.DocumentData): string {
  const type = normalizeStoredRehearsalType(data.type);
  if (type === "other") return typeof data.customType === "string" && data.customType.trim()
    ? data.customType.trim() : REHEARSAL_TYPE_LABELS.other;
  return REHEARSAL_TYPE_LABELS[type];
}

async function loadRehearsals(db: Firestore, projectId: string, date: string): Promise<{ all: ReminderRehearsal[]; active: ReminderRehearsal[] }> {
  const range = getTokyoDateRange(date);
  const snapshot = await db.collection("projects").doc(projectId).collection("rehearsals")
    .where("startAt", ">=", Timestamp.fromMillis(range.startMillis))
    .where("startAt", "<", Timestamp.fromMillis(range.endMillis))
    .orderBy("startAt", "asc").get();
  const all = snapshot.docs.flatMap((document) => {
    const data = document.data();
    const startAtMillis = asMillis(data.startAt);
    if (startAtMillis === null) return [];
    return [{
      id: document.id,
      startAtMillis,
      endAtMillis: asMillis(data.endAt),
      typeLabel: typeLabel(data),
      venue: typeof data.venue === "string" ? data.venue.trim() : "",
      cancelled: data.cancelled === true || data.status === "cancelled",
    }];
  });
  return { all, active: activeReminderRehearsals(all) };
}

export async function loadLineReminderPeople(db: Firestore, projectId: string): Promise<ReminderPerson[]> {
  const project = db.collection("projects").doc(projectId);
  const [people, participants] = await Promise.all([
    project.collection("people").get(),
    project.collection("participants").get(),
  ]);
  const merged = new Map<string, ReminderPerson>();
  for (const document of participants.docs) {
    const data = document.data();
    merged.set(document.id, {
      id: document.id,
      displayName: typeof data.displayName === "string" ? data.displayName : "",
      linkedUserUid: typeof data.linkedUserUid === "string" ? data.linkedUserUid : null,
      active: data.active !== false,
      attendanceTarget: data.active !== false,
    });
  }
  for (const document of people.docs) {
    const data = document.data();
    merged.set(document.id, {
      id: document.id,
      displayName: typeof data.displayName === "string" ? data.displayName : "",
      linkedUserUid: typeof data.linkedUserUid === "string" ? data.linkedUserUid : null,
      active: data.active === true,
      attendanceTarget: data.attendanceTarget === true,
    });
  }
  return [...merged.values()].filter((person) => person.active)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja") || left.id.localeCompare(right.id));
}

async function loadAttendance(db: Firestore, projectId: string, date: string): Promise<ReminderAttendance[]> {
  const snapshot = await db.collection("projects").doc(projectId).collection("attendanceRecords")
    .where("date", "==", date).get();
  return snapshot.docs.flatMap((document) => {
    const data = document.data();
    if (!["attending", "absent", "tentative"].includes(data.status) || typeof data.participantId !== "string") return [];
    return [{
      participantId: data.participantId,
      status: data.status as ReminderAttendance["status"],
      availableFrom: typeof data.availableFrom === "string" ? data.availableFrom : null,
      availableUntil: typeof data.availableUntil === "string" ? data.availableUntil : null,
    }];
  });
}

export async function loadLineReminderRecipients(db: Firestore, projectId: string, people: readonly ReminderPerson[]) {
  const candidates = [...new Map(people.filter((person) => person.linkedUserUid)
    .map((person) => [person.linkedUserUid!, person])).entries()];
  const linked: Array<{ uid: string; lineUserId: string }> = [];
  for (const [uid, person] of candidates) {
    const [participantLink, integration] = await Promise.all([
      db.collection("projects").doc(projectId).collection("participantLinkedUsers").doc(uid).get(),
      db.collection("userIntegrations").doc(uid).collection("providers").doc("line").get(),
    ]);
    const lineUserId = typeof integration.data()?.lineUserId === "string" ? integration.data()!.lineUserId : "";
    if (!participantLink.exists || participantLink.data()?.participantId !== person.id
      || !integration.exists || integration.data()?.provider !== "line"
      || integration.data()?.status !== "linked" || !lineUserId) continue;
    const reverse = await db.collection("lineUserLinks").doc(getLineUserLinkId(lineUserId)).get();
    if (reverse.exists && reverse.data()?.uid === uid && reverse.data()?.lineUserId === lineUserId) {
      linked.push({ uid, lineUserId });
    }
  }
  return { linked };
}

async function claimDelivery(db: Firestore, input: { projectId: string; date: string; uid: string; now: Timestamp }) {
  const id = buildLineReminderDeliveryId(input.projectId, input.date, input.uid);
  const reference = db.collection(DELIVERY_COLLECTION).doc(id);
  const operationId = randomBytes(18).toString("base64url");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    const attemptCount = Number.isInteger(data?.attemptCount) ? data!.attemptCount : 0;
    const retryKey = typeof data?.retryKey === "string" ? data.retryKey : randomUUID();
    if (data?.status === "sent" || data?.status === "failed_permanent" || attemptCount >= LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS) return null;
    if (data?.status === "sending" && (asMillis(data.leaseExpiresAt) ?? Number.POSITIVE_INFINITY) > input.now.toMillis()) return null;
    if (data?.status === "failed_retryable" && (asMillis(data.nextAttemptAt) ?? 0) > input.now.toMillis()) return null;
    transaction.set(reference, {
      projectId: input.projectId,
      rehearsalDate: input.date,
      recipientUid: input.uid,
      notificationType: LINE_REHEARSAL_REMINDER_TYPE,
      status: "sending",
      attemptCount: attemptCount + 1,
      retryKey,
      operationId,
      leaseExpiresAt: Timestamp.fromMillis(input.now.toMillis() + SEND_LEASE_MS),
      createdAt: snapshot.exists ? data?.createdAt ?? input.now : input.now,
      updatedAt: input.now,
      sentAt: data?.sentAt ?? null,
      failedAt: null,
      errorCategory: null,
      nextAttemptAt: null,
    }, { merge: true });
    return { reference, operationId, retryKey, attemptCount: attemptCount + 1 };
  });
}

async function deliveryAlreadySent(db: Firestore, projectId: string, date: string, uid: string): Promise<boolean> {
  const snapshot = await db.collection(DELIVERY_COLLECTION).doc(buildLineReminderDeliveryId(projectId, date, uid)).get();
  return snapshot.data()?.status === "sent";
}

async function finishDelivery(db: Firestore, claim: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>, error?: unknown) {
  const now = Timestamp.now();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(claim.reference);
    if (!snapshot.exists || snapshot.data()?.operationId !== claim.operationId) return;
    if (!error) {
      transaction.update(claim.reference, {
        status: "sent", sentAt: now, updatedAt: now, leaseExpiresAt: null,
        operationId: null, errorCategory: null, nextAttemptAt: null,
      });
      return;
    }
    const code = error instanceof LineMessagingError ? error.code : "line_network_error";
    const status = classifyLineReminderFailure(code, claim.attemptCount);
    transaction.update(claim.reference, {
      status, failedAt: now, updatedAt: now, leaseExpiresAt: null,
      operationId: null, errorCategory: code,
      nextAttemptAt: status === "failed_retryable"
        ? Timestamp.fromMillis(now.toMillis() + RETRY_DELAY_MS) : null,
    });
  });
}

export async function runLineRehearsalReminderForDate(input: {
  date: string;
  projectId?: string;
  recipientUids?: readonly string[];
  dryRun?: boolean;
  now?: Timestamp;
  db?: Firestore;
  send?: LineSender;
}): Promise<LineReminderRunSummary> {
  const db = input.db ?? adminDb;
  const now = input.now ?? Timestamp.now();
  const projects = input.projectId
    ? [await db.collection("projects").doc(input.projectId).get()].filter((item) => item.exists)
    : (await db.collection("projects").get()).docs;
  const onlyRecipients = input.recipientUids ? new Set(input.recipientUids) : null;
  const result = emptySummary();
  for (const project of projects) {
    const rehearsals = await loadRehearsals(db, project.id, input.date);
    result.cancelledExcludedCount += rehearsals.all.length - rehearsals.active.length;
    if (!rehearsals.active.length) continue;
    const [people, attendance] = await Promise.all([
      loadLineReminderPeople(db, project.id), loadAttendance(db, project.id, input.date),
    ]);
    const recipients = await loadLineReminderRecipients(db, project.id, people);
    const selected = recipients.linked.filter(({ uid }) => !onlyRecipients || onlyRecipients.has(uid));
    const attendanceSummary = buildReminderAttendanceSummary({ people, attendance, rehearsals: rehearsals.active });
    const message = buildLineRehearsalReminderMessage({ date: input.date, rehearsals: rehearsals.active, attendance: attendanceSummary });
    result.targetProjectCount += 1;
    result.rehearsalCount += rehearsals.active.length;
    result.participantCount += people.length;
    result.linkedCount += recipients.linked.length;
    result.unlinkedCount += Math.max(0, people.length - recipients.linked.length);
    result.messagePreviews.push(message);
    for (const recipient of selected) {
      if (input.dryRun) {
        if (await deliveryAlreadySent(db, project.id, input.date, recipient.uid)) {
          result.duplicateExcludedCount += 1;
          result.skippedCount += 1;
        } else {
          result.recipientCount += 1;
        }
        continue;
      }
      const claim = await claimDelivery(db, { projectId: project.id, date: input.date, uid: recipient.uid, now });
      if (!claim) {
        result.duplicateExcludedCount += 1;
        result.skippedCount += 1;
        continue;
      }
      result.recipientCount += 1;
      try {
        await (input.send ?? ((payload) => sendLinePushTextMessage({
          ...payload, accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
        })) )({ lineUserId: recipient.lineUserId, text: message, retryKey: claim.retryKey });
        await finishDelivery(db, claim);
        result.sentCount += 1;
      } catch (error) {
        await finishDelivery(db, claim, error);
        result.failedCount += 1;
      }
    }
  }
  return result;
}

export async function runTomorrowLineRehearsalReminders(input: {
  now?: Date;
  dryRun?: boolean;
  db?: Firestore;
  send?: LineSender;
} = {}): Promise<LineReminderRunSummary> {
  return runLineRehearsalReminderForDate({
    date: getNextTokyoDate(input.now), dryRun: input.dryRun, db: input.db, send: input.send,
  });
}

export async function retryDueLineRehearsalReminders(input: {
  now?: Timestamp;
  db?: Firestore;
  send?: LineSender;
} = {}): Promise<LineReminderRunSummary[]> {
  const db = input.db ?? adminDb;
  const now = input.now ?? Timestamp.now();
  const snapshot = await db.collection(DELIVERY_COLLECTION)
    .where("notificationType", "==", LINE_REHEARSAL_REMINDER_TYPE)
    .where("status", "==", "failed_retryable")
    .limit(100)
    .get();
  const due = snapshot.docs.filter((document) => (asMillis(document.data().nextAttemptAt) ?? Number.POSITIVE_INFINITY) <= now.toMillis());
  const groups = new Map<string, { projectId: string; date: string; uids: string[] }>();
  for (const document of due) {
    const data = document.data();
    if (typeof data.projectId !== "string" || typeof data.rehearsalDate !== "string" || typeof data.recipientUid !== "string") continue;
    const key = `${data.projectId}:${data.rehearsalDate}`;
    const group = groups.get(key) ?? { projectId: data.projectId, date: data.rehearsalDate, uids: [] };
    group.uids.push(data.recipientUid);
    groups.set(key, group);
  }
  const results: LineReminderRunSummary[] = [];
  for (const group of groups.values()) {
    results.push(await runLineRehearsalReminderForDate({
      projectId: group.projectId, date: group.date, recipientUids: group.uids,
      now, db, send: input.send,
    }));
  }
  return results;
}
