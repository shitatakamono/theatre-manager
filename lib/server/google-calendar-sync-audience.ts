import "server-only";

import {
  buildGoogleCalendarProjectSyncAudience,
  selectGoogleCalendarMappingOwnerUids,
  type GoogleCalendarConnectionCandidate,
  type GoogleCalendarLinkedUserCandidate,
  type GoogleCalendarSyncAudience,
} from "@/lib/google-calendar-sync-audience";
import { adminDb } from "@/lib/server/firebase-admin";

const CONNECTIONS_COLLECTION = "googleCalendarConnections";
const EVENT_MAPPINGS_COLLECTION = "eventMappings";

function requireProjectId(projectId: string): string {
  const normalized = projectId.trim();
  if (!normalized || normalized.includes("/")) {
    throw new Error("projectId is required");
  }
  return normalized;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasEncryptedRefreshToken(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const token = value as Record<string, unknown>;
  return typeof token.ciphertext === "string" && token.ciphertext.length > 0
    && typeof token.iv === "string" && token.iv.length > 0
    && typeof token.authTag === "string" && token.authTag.length > 0;
}

export function isGoogleCalendarConnectionCredentialAvailable(
  data: FirebaseFirestore.DocumentData | undefined
): boolean {
  return hasEncryptedRefreshToken(data?.refreshToken);
}

async function loadGoogleCalendarLinkedAudienceInputs(projectId: string): Promise<{
  linkedUsers: GoogleCalendarLinkedUserCandidate[];
  memberUids: string[];
  personIds: string[];
  connections: GoogleCalendarConnectionCandidate[];
}> {
  const projectRef = adminDb.collection("projects").doc(projectId);
  const linkedSnapshot = await projectRef.collection("participantLinkedUsers").get();
  const linkedUsers = linkedSnapshot.docs.map((document) => ({
    uid: document.id,
    participantId: optionalString(document.data().participantId),
  }));

  if (linkedUsers.length === 0) {
    return { linkedUsers, memberUids: [], personIds: [], connections: [] };
  }

  const uniqueUids = [...new Set(linkedUsers.map(({ uid }) => uid))];
  const uniqueParticipantIds = [
    ...new Set(linkedUsers
      .map(({ participantId }) => participantId)
      .filter((participantId) => participantId && !participantId.includes("/"))),
  ];
  const memberRefs = uniqueUids.map((uid) =>
    projectRef.collection("members").doc(uid));
  const personRefs = uniqueParticipantIds.map((participantId) =>
    projectRef.collection("people").doc(participantId));
  const connectionRefs = uniqueUids.map((uid) =>
    adminDb.collection(CONNECTIONS_COLLECTION).doc(uid));

  const [memberSnapshots, personSnapshots, connectionSnapshots] = await Promise.all([
    memberRefs.length > 0 ? adminDb.getAll(...memberRefs) : [],
    personRefs.length > 0 ? adminDb.getAll(...personRefs) : [],
    connectionRefs.length > 0 ? adminDb.getAll(...connectionRefs) : [],
  ]);

  return {
    linkedUsers,
    memberUids: memberSnapshots.filter((snapshot) => snapshot.exists)
      .map((snapshot) => snapshot.id),
    personIds: personSnapshots.filter((snapshot) => snapshot.exists)
      .map((snapshot) => snapshot.id),
    connections: connectionSnapshots.map((snapshot) => {
      const data = snapshot.data();
      return {
        uid: snapshot.id,
        connected: data?.connected === true,
        credentialAvailable: isGoogleCalendarConnectionCredentialAvailable(data),
      };
    }),
  };
}

export async function getGoogleCalendarSyncUsersForProject(
  projectId: string
): Promise<GoogleCalendarSyncAudience> {
  const normalizedProjectId = requireProjectId(projectId);
  const inputs = await loadGoogleCalendarLinkedAudienceInputs(normalizedProjectId);
  return buildGoogleCalendarProjectSyncAudience({
    ...inputs,
    mappingOwnerUids: [],
  });
}

export async function getGoogleCalendarMappingOwnersForProject(
  projectId: string
): Promise<string[]> {
  const normalizedProjectId = requireProjectId(projectId);
  const snapshot = await adminDb
    .collectionGroup(EVENT_MAPPINGS_COLLECTION)
    .where("projectId", "==", normalizedProjectId)
    .get();
  const candidates: Array<{ uid: string; projectId: string }> = [];

  for (const document of snapshot.docs) {
    const connectionRef = document.ref.parent.parent;
    if (!connectionRef
      || connectionRef.parent.id !== CONNECTIONS_COLLECTION
      || !connectionRef.id) {
      continue;
    }
    candidates.push({
      uid: connectionRef.id,
      projectId: optionalString(document.data().projectId),
    });
  }

  return selectGoogleCalendarMappingOwnerUids(
    normalizedProjectId,
    candidates
  );
}

export async function getGoogleCalendarProjectSyncAudience(
  projectId: string
): Promise<GoogleCalendarSyncAudience> {
  const normalizedProjectId = requireProjectId(projectId);
  const [inputs, mappingOwnerUids] = await Promise.all([
    loadGoogleCalendarLinkedAudienceInputs(normalizedProjectId),
    getGoogleCalendarMappingOwnersForProject(normalizedProjectId),
  ]);
  return buildGoogleCalendarProjectSyncAudience({
    ...inputs,
    mappingOwnerUids,
  });
}
