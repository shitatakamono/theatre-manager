import "server-only";

import { randomBytes } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import {
  buildGoogleCalendarEventMappingId,
  decideGoogleCalendarEventLease,
  decideGoogleCalendarEventUpdateLease,
  ownsGoogleCalendarEventLease,
  ownsGoogleCalendarEventUpdateLease,
  type GoogleCalendarEventLeaseState,
  type GoogleCalendarEventUpdateLeaseState,
} from "@/lib/google-calendar-event-mapping";
import { adminDb } from "@/lib/server/firebase-admin";

const CONNECTIONS_COLLECTION = "googleCalendarConnections";
const EVENT_MAPPINGS_COLLECTION = "eventMappings";

export type GoogleCalendarEventMapping = {
  status: "synced";
  projectId: string;
  rehearsalId: string;
  calendarId: string;
  googleEventId: string;
  sourceRevision: number;
  sourceHash: string;
  lastSyncedAt: Timestamp | null;
  lastErrorCode: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type SaveGoogleCalendarEventMappingInput = Omit<
  GoogleCalendarEventMapping,
  "status" | "createdAt" | "updatedAt"
>;

export type GoogleCalendarEventLeaseClaim =
  | { kind: "acquired"; operationId: string }
  | { kind: "synced" }
  | { kind: "in_progress" };

export type GoogleCalendarEventUpdateLeaseClaim =
  | { kind: "acquired"; operationId: string; mapping: GoogleCalendarEventMapping }
  | { kind: "unchanged" }
  | { kind: "in_progress" }
  | { kind: "missing" };

function mappingRef(uid: string, projectId: string, rehearsalId: string) {
  const mappingId = buildGoogleCalendarEventMappingId(projectId, rehearsalId);
  return adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid)
    .collection(EVENT_MAPPINGS_COLLECTION)
    .doc(mappingId);
}

function storedLeaseState(
  data: FirebaseFirestore.DocumentData | undefined
): GoogleCalendarEventLeaseState {
  if (!data) return null;
  if (
    typeof data.calendarId === "string"
    && data.calendarId
    && typeof data.googleEventId === "string"
    && data.googleEventId
  ) {
    return { status: "synced" };
  }
  if (
    data.status === "creating"
    && typeof data.operationId === "string"
    && data.operationId
    && data.startedAt instanceof Timestamp
  ) {
    return {
      status: "creating",
      operationId: data.operationId,
      startedAtMillis: data.startedAt.toMillis(),
    };
  }
  return null;
}

function storedMapping(
  data: FirebaseFirestore.DocumentData | undefined
): GoogleCalendarEventMapping | null {
  if (!data
    || typeof data.projectId !== "string"
    || typeof data.rehearsalId !== "string"
    || typeof data.calendarId !== "string"
    || !data.calendarId
    || typeof data.googleEventId !== "string"
    || !data.googleEventId
    || typeof data.sourceRevision !== "number"
    || typeof data.sourceHash !== "string"
    || !data.sourceHash
    || !(data.createdAt instanceof Timestamp)
    || !(data.updatedAt instanceof Timestamp)) {
    return null;
  }
  return { ...data, status: "synced" } as GoogleCalendarEventMapping;
}

function storedUpdateLeaseState(
  data: FirebaseFirestore.DocumentData
): GoogleCalendarEventUpdateLeaseState | null {
  const mapping = storedMapping(data);
  if (!mapping) return null;
  if (data.status === "updating"
    && typeof data.operationId === "string"
    && data.operationId
    && data.startedAt instanceof Timestamp
    && typeof data.targetSourceHash === "string"
    && data.targetSourceHash) {
    return {
      status: "updating",
      operationId: data.operationId,
      startedAtMillis: data.startedAt.toMillis(),
      sourceHash: mapping.sourceHash,
      targetSourceHash: data.targetSourceHash,
    };
  }
  return { status: "synced", sourceHash: mapping.sourceHash };
}

export async function getGoogleCalendarEventMapping(
  uid: string,
  projectId: string,
  rehearsalId: string
): Promise<GoogleCalendarEventMapping | null> {
  const snapshot = await mappingRef(uid, projectId, rehearsalId).get();
  const data = snapshot.data();
  return storedMapping(data);
}

export async function getGoogleCalendarEventMappingsForProject(
  uid: string,
  projectId: string
): Promise<GoogleCalendarEventMapping[]> {
  const snapshot = await adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid)
    .collection(EVENT_MAPPINGS_COLLECTION)
    .where("projectId", "==", projectId)
    .get();
  return snapshot.docs.flatMap((document) => {
    const mapping = storedMapping(document.data());
    return mapping ? [mapping] : [];
  });
}

export async function saveGoogleCalendarEventMapping(
  uid: string,
  input: SaveGoogleCalendarEventMappingInput
): Promise<void> {
  const ref = mappingRef(uid, input.projectId, input.rehearsalId);

  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const existingCreatedAt = snapshot.data()?.createdAt;
    const now = Timestamp.now();

    transaction.set(ref, {
      ...input,
      status: "synced",
      createdAt: existingCreatedAt instanceof Timestamp ? existingCreatedAt : now,
      updatedAt: now,
    });
  });
}

export async function claimGoogleCalendarEventLease(
  uid: string,
  projectId: string,
  rehearsalId: string
): Promise<GoogleCalendarEventLeaseClaim> {
  const ref = mappingRef(uid, projectId, rehearsalId);
  const operationId = randomBytes(18).toString("base64url");

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const now = Timestamp.now();
    const decision = decideGoogleCalendarEventLease(
      storedLeaseState(data),
      now.toMillis()
    );

    if (decision === "synced") return { kind: "synced" };
    if (decision === "in_progress") return { kind: "in_progress" };

    transaction.set(ref, {
      status: "creating",
      projectId,
      rehearsalId,
      operationId,
      startedAt: now,
      createdAt: data?.createdAt instanceof Timestamp ? data.createdAt : now,
      updatedAt: now,
    });
    return { kind: "acquired", operationId };
  });
}

export async function completeGoogleCalendarEventLease(
  uid: string,
  operationId: string,
  input: SaveGoogleCalendarEventMappingInput
): Promise<boolean> {
  const ref = mappingRef(uid, input.projectId, input.rehearsalId);

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    if (!ownsGoogleCalendarEventLease(storedLeaseState(data), operationId)) {
      return false;
    }

    const now = Timestamp.now();
    transaction.set(ref, {
      ...input,
      status: "synced",
      createdAt: data?.createdAt instanceof Timestamp ? data.createdAt : now,
      updatedAt: now,
    });
    return true;
  });
}

export async function releaseGoogleCalendarEventLease(
  uid: string,
  projectId: string,
  rehearsalId: string,
  operationId: string
): Promise<boolean> {
  const ref = mappingRef(uid, projectId, rehearsalId);

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!ownsGoogleCalendarEventLease(storedLeaseState(snapshot.data()), operationId)) {
      return false;
    }
    transaction.delete(ref);
    return true;
  });
}

export async function claimGoogleCalendarEventUpdateLease(
  uid: string,
  projectId: string,
  rehearsalId: string,
  targetSourceHash: string
): Promise<GoogleCalendarEventUpdateLeaseClaim> {
  const ref = mappingRef(uid, projectId, rehearsalId);
  const operationId = randomBytes(18).toString("base64url");

  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const state = data ? storedUpdateLeaseState(data) : null;
    const mapping = storedMapping(data);
    if (!state || !mapping) return { kind: "missing" };

    const now = Timestamp.now();
    const decision = decideGoogleCalendarEventUpdateLease(
      state,
      targetSourceHash,
      now.toMillis()
    );
    if (decision === "unchanged") return { kind: "unchanged" };
    if (decision === "in_progress") return { kind: "in_progress" };

    transaction.update(ref, {
      status: "updating",
      operationId,
      startedAt: now,
      targetSourceHash,
      updatedAt: now,
    });
    return { kind: "acquired", operationId, mapping };
  });
}

export async function completeGoogleCalendarEventUpdateLease(
  uid: string,
  projectId: string,
  rehearsalId: string,
  operationId: string,
  input: { sourceRevision: number; sourceHash: string; lastSyncedAt: Timestamp }
): Promise<boolean> {
  const ref = mappingRef(uid, projectId, rehearsalId);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const state = data ? storedUpdateLeaseState(data) : null;
    if (!state || !ownsGoogleCalendarEventUpdateLease(
      state,
      operationId,
      input.sourceHash
    )) return false;

    transaction.update(ref, {
      status: "synced",
      sourceRevision: input.sourceRevision,
      sourceHash: input.sourceHash,
      lastSyncedAt: input.lastSyncedAt,
      lastErrorCode: null,
      operationId: FieldValue.delete(),
      startedAt: FieldValue.delete(),
      targetSourceHash: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
    return true;
  });
}

export async function failGoogleCalendarEventUpdateLease(
  uid: string,
  projectId: string,
  rehearsalId: string,
  operationId: string,
  targetSourceHash: string,
  errorCode: string
): Promise<boolean> {
  const ref = mappingRef(uid, projectId, rehearsalId);
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const state = data ? storedUpdateLeaseState(data) : null;
    if (!state || !ownsGoogleCalendarEventUpdateLease(
      state,
      operationId,
      targetSourceHash
    )) return false;
    transaction.update(ref, {
      status: "synced",
      lastErrorCode: errorCode,
      operationId: FieldValue.delete(),
      startedAt: FieldValue.delete(),
      targetSourceHash: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    });
    return true;
  });
}

export async function deleteGoogleCalendarEventMapping(
  uid: string,
  projectId: string,
  rehearsalId: string
): Promise<void> {
  await mappingRef(uid, projectId, rehearsalId).delete();
}
