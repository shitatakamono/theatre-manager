import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";

import { buildLineLinkNotificationMessage, type LineLinkEventType } from "../line-link-events.ts";
import { getLineUserLinkId, requireFirebaseUid } from "../line-account-link.ts";
import { classifyLineReminderFailure, LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS } from "../line-rehearsal-reminder.ts";
import { adminDb } from "./firebase-admin.ts";
import { LineMessagingError, sendLinePushTextMessage } from "./line-messaging.ts";

const EVENTS = "lineLinkEvents";
const DELIVERIES = "lineNotificationDeliveries";
const LEASE_MS = 5 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;

export class LineProjectLinkError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 409) {
    super(code);
    this.name = "LineProjectLinkError";
    this.code = code;
    this.status = status;
  }
}

function hash(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("base64url");
}

function text(value: unknown, fallback: string, max = 200): string {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

function projectName(data: FirebaseFirestore.DocumentData | undefined): string {
  return text(data?.performanceName, text(data?.title, "公演"));
}

export function lineLinkEventId(source: string, projectId: string, personId: string): string {
  return hash("line-link-event", source, projectId, personId);
}

export function writeLineLinkEvent(
  transaction: Transaction,
  input: {
    projectRef: FirebaseFirestore.DocumentReference;
    eventId: string;
    eventType: LineLinkEventType;
    personId: string;
    personName: string;
    lineDisplayName: string;
    source: "invite_signup" | "invite_claim" | "settings_relink" | "admin_repair";
    occurredAt: Timestamp;
  }
): void {
  transaction.create(input.projectRef.collection(EVENTS).doc(input.eventId), {
    eventType: input.eventType,
    personId: input.personId,
    personName: input.personName.trim().slice(0, 100) || "関係者",
    lineDisplayName: input.lineDisplayName.trim().slice(0, 128) || "表示名未取得",
    source: input.source,
    occurredAt: input.occurredAt,
  });
}

type Sender = (input: { lineUserId: string; text: string; retryKey: string }) => Promise<void>;

export type LineLinkDispatchSummary = {
  sentCount: number;
  failedCount: number;
  skippedCount: number;
};

function asMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

async function claimDelivery(db: Firestore, input: {
  projectId: string;
  eventId: string;
  ownerUid: string;
  now: Timestamp;
}) {
  const reference = db.collection(DELIVERIES).doc(hash("line-link-notification", input.eventId, input.ownerUid));
  const operationId = randomBytes(18).toString("base64url");
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const data = snapshot.data();
    const attempts = Number.isInteger(data?.attemptCount) ? data!.attemptCount : 0;
    if (data?.status === "sent" || data?.status === "failed_permanent"
      || attempts >= LINE_REHEARSAL_REMINDER_MAX_ATTEMPTS) return null;
    if (data?.status === "sending"
      && (asMillis(data.leaseExpiresAt) ?? Number.POSITIVE_INFINITY) > input.now.toMillis()) return null;
    if (data?.status === "failed_retryable"
      && (asMillis(data.nextAttemptAt) ?? 0) > input.now.toMillis()) return null;
    const retryKey = typeof data?.retryKey === "string" ? data.retryKey : randomUUID();
    transaction.set(reference, {
      projectId: input.projectId,
      lineLinkEventId: input.eventId,
      recipientUid: input.ownerUid,
      notificationType: "line_account_linked",
      status: "sending",
      attemptCount: attempts + 1,
      retryKey,
      operationId,
      leaseExpiresAt: Timestamp.fromMillis(input.now.toMillis() + LEASE_MS),
      createdAt: snapshot.exists ? data?.createdAt ?? input.now : input.now,
      updatedAt: input.now,
      sentAt: data?.sentAt ?? null,
      failedAt: null,
      errorCategory: null,
      nextAttemptAt: null,
    }, { merge: true });
    return { reference, operationId, retryKey, attemptCount: attempts + 1 };
  });
}

async function finishDelivery(
  db: Firestore,
  claim: NonNullable<Awaited<ReturnType<typeof claimDelivery>>>,
  error?: unknown
): Promise<void> {
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
      status, failedAt: now, updatedAt: now, leaseExpiresAt: null, operationId: null,
      errorCategory: code,
      nextAttemptAt: status === "failed_retryable"
        ? Timestamp.fromMillis(now.toMillis() + RETRY_DELAY_MS) : null,
    });
  });
}

export async function dispatchLineLinkEvent(input: {
  projectId: string;
  eventId: string;
  db?: Firestore;
  send?: Sender;
}): Promise<LineLinkDispatchSummary> {
  const db = input.db ?? adminDb;
  const result: LineLinkDispatchSummary = { sentCount: 0, failedCount: 0, skippedCount: 0 };
  const projectRef = db.collection("projects").doc(input.projectId);
  const [project, event, owners] = await Promise.all([
    projectRef.get(),
    projectRef.collection(EVENTS).doc(input.eventId).get(),
    projectRef.collection("members").where("role", "==", "owner").get(),
  ]);
  if (!project.exists || !event.exists || event.data()?.eventType === "project_link_removed") return result;
  const data = event.data()!;
  const message = buildLineLinkNotificationMessage({
    projectName: projectName(project.data()),
    personName: text(data.personName, "関係者", 100),
    lineDisplayName: text(data.lineDisplayName, "表示名未取得", 128),
    eventType: data.eventType === "relinked" ? "relinked" : "linked",
  });
  for (const owner of owners.docs) {
    const integration = await db.collection("userIntegrations").doc(owner.id).collection("providers").doc("line").get();
    const integrationData = integration.data();
    if (!integration.exists || integrationData?.status !== "linked"
      || integrationData?.deliveryStatus === "unreachable"
      || typeof integrationData?.lineUserId !== "string") {
      result.skippedCount += 1;
      continue;
    }
    const reverse = await db.collection("lineUserLinks").doc(getLineUserLinkId(integrationData.lineUserId)).get();
    if (!reverse.exists || reverse.data()?.uid !== owner.id
      || reverse.data()?.lineUserId !== integrationData.lineUserId) {
      result.skippedCount += 1;
      continue;
    }
    const claim = await claimDelivery(db, {
      projectId: input.projectId, eventId: input.eventId, ownerUid: owner.id, now: Timestamp.now(),
    });
    if (!claim) {
      result.skippedCount += 1;
      continue;
    }
    try {
      await (input.send ?? ((payload) => sendLinePushTextMessage({
        ...payload, accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      })) )({ lineUserId: integrationData.lineUserId, text: message, retryKey: claim.retryKey });
      await finishDelivery(db, claim);
      result.sentCount += 1;
    } catch (error) {
      await finishDelivery(db, claim, error);
      result.failedCount += 1;
    }
  }
  return result;
}

export async function retryDueLineLinkEvents(input: {
  now?: Timestamp;
  db?: Firestore;
  send?: Sender;
} = {}): Promise<LineLinkDispatchSummary> {
  const db = input.db ?? adminDb;
  const now = input.now ?? Timestamp.now();
  const snapshot = await db.collection(DELIVERIES)
    .where("notificationType", "==", "line_account_linked")
    .where("status", "==", "failed_retryable")
    .limit(100)
    .get();
  const events = new Map<string, { projectId: string; eventId: string }>();
  for (const document of snapshot.docs) {
    const data = document.data();
    if ((asMillis(data.nextAttemptAt) ?? Number.POSITIVE_INFINITY) > now.toMillis()
      || typeof data.projectId !== "string"
      || typeof data.lineLinkEventId !== "string") continue;
    events.set(`${data.projectId}\u0000${data.lineLinkEventId}`, {
      projectId: data.projectId,
      eventId: data.lineLinkEventId,
    });
  }
  const result: LineLinkDispatchSummary = { sentCount: 0, failedCount: 0, skippedCount: 0 };
  for (const event of events.values()) {
    const current = await dispatchLineLinkEvent({ ...event, db, send: input.send });
    result.sentCount += current.sentCount;
    result.failedCount += current.failedCount;
    result.skippedCount += current.skippedCount;
  }
  return result;
}

export async function recordRelinkEvents(input: {
  uid: string;
  lineDisplayName: string;
  sourceId: string;
  db?: Firestore;
}): Promise<void> {
  const db = input.db ?? adminDb;
  const uid = requireFirebaseUid(input.uid);
  const projects = await db.collection("projects").where("memberUids", "array-contains", uid).get();
  for (const project of projects.docs) {
    const reverse = await project.ref.collection("participantLinkedUsers").doc(uid).get();
    const personId = typeof reverse.data()?.participantId === "string" ? reverse.data()!.participantId : "";
    if (!reverse.exists || !personId) continue;
    const person = await project.ref.collection("people").doc(personId).get();
    if (!person.exists || person.data()?.linkedUserUid !== uid) continue;
    const eventId = lineLinkEventId(input.sourceId, project.id, personId);
    const previous = await project.ref.collection(EVENTS).where("personId", "==", personId).limit(1).get();
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(project.ref.collection(EVENTS).doc(eventId));
      if (existing.exists) return;
      writeLineLinkEvent(transaction, {
        projectRef: project.ref, eventId, eventType: previous.empty ? "linked" : "relinked", personId,
        personName: text(person.data()?.displayName, "関係者", 100),
        lineDisplayName: input.lineDisplayName, source: "settings_relink", occurredAt: Timestamp.now(),
      });
    });
  }
}

export type LineLinkHistoryItem = {
  id: string;
  eventType: LineLinkEventType;
  personName: string;
  lineDisplayName: string;
  occurredAt: string;
};

async function requireOwner(db: Firestore, projectId: string, uid: string) {
  const member = await db.collection("projects").doc(projectId).collection("members").doc(uid).get();
  if (!member.exists || member.data()?.role !== "owner") throw new LineProjectLinkError("forbidden", 403);
}

export async function listLineLinkEvents(input: {
  uid: string;
  projectId: string;
  db?: Firestore;
}): Promise<LineLinkHistoryItem[]> {
  const db = input.db ?? adminDb;
  await requireOwner(db, input.projectId, requireFirebaseUid(input.uid));
  const snapshot = await db.collection("projects").doc(input.projectId).collection(EVENTS)
    .orderBy("occurredAt", "desc").limit(100).get();
  return snapshot.docs.map((document) => {
    const data = document.data();
    return {
      id: document.id,
      eventType: ["linked", "relinked", "project_link_removed"].includes(data.eventType)
        ? data.eventType as LineLinkEventType : "linked",
      personName: text(data.personName, "関係者", 100),
      lineDisplayName: text(data.lineDisplayName, "表示名未取得", 128),
      occurredAt: data.occurredAt instanceof Timestamp ? data.occurredAt.toDate().toISOString() : "",
    };
  });
}

export async function repairProjectPersonLineLink(input: {
  ownerUid: string;
  projectId: string;
  personId: string;
  db?: Firestore;
}): Promise<{ eventId: string }> {
  const db = input.db ?? adminDb;
  const ownerUid = requireFirebaseUid(input.ownerUid);
  const projectRef = db.collection("projects").doc(input.projectId);
  return db.runTransaction(async (transaction) => {
    const [project, owner, person, participant] = await Promise.all([
      transaction.get(projectRef),
      transaction.get(projectRef.collection("members").doc(ownerUid)),
      transaction.get(projectRef.collection("people").doc(input.personId)),
      transaction.get(projectRef.collection("participants").doc(input.personId)),
    ]);
    if (!project.exists || !person.exists) throw new LineProjectLinkError("not_found", 404);
    if (!owner.exists || owner.data()?.role !== "owner") throw new LineProjectLinkError("forbidden", 403);
    const linkedUid = typeof person.data()?.linkedUserUid === "string" ? person.data()!.linkedUserUid.trim() : "";
    if (!linkedUid) throw new LineProjectLinkError("not_linked", 409);
    if (!participant.exists || participant.data()?.linkedUserUid !== linkedUid) {
      throw new LineProjectLinkError("link_inconsistent", 409);
    }
    const [reverse, member, linkedPeople, integration] = await Promise.all([
      transaction.get(projectRef.collection("participantLinkedUsers").doc(linkedUid)),
      transaction.get(projectRef.collection("members").doc(linkedUid)),
      transaction.get(projectRef.collection("people").where("linkedUserUid", "==", linkedUid)),
      transaction.get(db.collection("userIntegrations").doc(linkedUid).collection("providers").doc("line")),
    ]);
    if (!reverse.exists || reverse.data()?.participantId !== input.personId || !member.exists) {
      throw new LineProjectLinkError("link_inconsistent", 409);
    }
    if (linkedPeople.docs.some((document) => document.id !== input.personId)) {
      throw new LineProjectLinkError("other_person_linked", 409);
    }
    if (member.data()?.role !== "viewer") throw new LineProjectLinkError("privileged_member", 409);
    const memberUids = Array.isArray(project.data()?.memberUids) ? project.data()!.memberUids : [];
    if (!memberUids.includes(linkedUid)) throw new LineProjectLinkError("membership_inconsistent", 409);
    const now = Timestamp.now();
    const eventId = hash("admin-repair", input.projectId, input.personId, randomUUID());
    transaction.update(person.ref, { linkedUserUid: null, updatedAt: now, updatedByUid: ownerUid });
    transaction.update(participant.ref, { linkedUserUid: null, updatedAt: now, updatedByUid: ownerUid });
    transaction.delete(reverse.ref);
    transaction.delete(member.ref);
    transaction.update(projectRef, { memberUids: FieldValue.arrayRemove(linkedUid) });
    writeLineLinkEvent(transaction, {
      projectRef, eventId, eventType: "project_link_removed", personId: input.personId,
      personName: text(person.data()?.displayName, "関係者", 100),
      lineDisplayName: text(integration.data()?.lineDisplayName, "表示名未取得", 128),
      source: "admin_repair", occurredAt: now,
    });
    return { eventId };
  });
}
