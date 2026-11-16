import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import {
  parseGoogleCalendarSyncTypes,
} from "../google-calendar-sync-preferences.ts";
import type { RehearsalType } from "../rehearsals.ts";
import { adminDb } from "./firebase-admin.ts";

const CONNECTIONS_COLLECTION = "googleCalendarConnections";
const PROJECT_SETTINGS_COLLECTION = "projectSettings";

export type GoogleCalendarProjectSyncPreference = {
  rehearsalTypes: RehearsalType[];
  updatedAt: Timestamp | null;
};

function preferenceRef(uid: string, projectId: string) {
  return adminDb
    .collection(CONNECTIONS_COLLECTION)
    .doc(uid)
    .collection(PROJECT_SETTINGS_COLLECTION)
    .doc(projectId);
}

export async function getGoogleCalendarProjectSyncPreference(
  uid: string,
  projectId: string
): Promise<GoogleCalendarProjectSyncPreference | null> {
  const snapshot = await preferenceRef(uid, projectId).get();
  if (!snapshot.exists) return null;
  return {
    rehearsalTypes: parseGoogleCalendarSyncTypes(snapshot.data()?.rehearsalTypes),
    updatedAt: snapshot.data()?.updatedAt instanceof Timestamp
      ? snapshot.data()?.updatedAt
      : null,
  };
}

export async function saveGoogleCalendarProjectSyncPreference(
  uid: string,
  projectId: string,
  rehearsalTypes: unknown
): Promise<GoogleCalendarProjectSyncPreference> {
  const normalized = parseGoogleCalendarSyncTypes(rehearsalTypes);
  const updatedAt = Timestamp.now();
  await preferenceRef(uid, projectId).set({
    projectId,
    rehearsalTypes: normalized,
    updatedAt,
  });
  return { rehearsalTypes: normalized, updatedAt };
}
