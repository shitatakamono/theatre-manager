import { timingSafeEqual } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { ProjectRole } from "../auth.ts";
import {
  buildRehearsalSharePath,
  generateRehearsalShareToken,
  hashRehearsalShareToken,
  isValidRehearsalShareToken,
  type PublicRehearsalItem,
  type PublicRehearsalSchedule,
} from "../rehearsal-share.ts";
import { adminAuth, adminDb } from "./firebase-admin.ts";

const SHARE_COLLECTION = "publicRehearsalShares";
const REHEARSAL_TYPES = new Set(["acting", "japanese_dance", "stage_combat", "meeting", "other"]);

type StoredShare = {
  enabled?: unknown;
  token?: unknown;
  tokenHash?: unknown;
  updatedAt?: unknown;
};

function shareRef(projectId: string) {
  return adminDb.collection(SHARE_COLLECTION).doc(projectId);
}

function tokensEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function toIso(value: unknown): string | null {
  return value instanceof Timestamp ? value.toDate().toISOString() : null;
}

function mapPublicRehearsal(data: Record<string, unknown>): PublicRehearsalItem | null {
  const startAt = toIso(data.startAt);
  if (!startAt || !REHEARSAL_TYPES.has(data.type as string)) return null;
  const type = data.type as PublicRehearsalItem["type"];
  return {
    startAt,
    endAt: toIso(data.endAt),
    type,
    customType: type === "other" && typeof data.customType === "string" ? data.customType.slice(0, 100) : "",
    venue: typeof data.venue === "string" ? data.venue.slice(0, 200) : "",
  };
}

export async function verifyRehearsalShareIdToken(idToken: string): Promise<{ uid: string }> {
  return adminAuth.verifyIdToken(idToken);
}

export async function getRehearsalShareProjectRole(projectId: string, uid: string): Promise<ProjectRole | null> {
  const snapshot = await adminDb.collection("projects").doc(projectId).collection("members").doc(uid).get();
  const role = snapshot.data()?.role;
  return role === "owner" || role === "editor" || role === "viewer" ? role : null;
}

export async function getRehearsalShareStatus(projectId: string): Promise<{ enabled: boolean; path: string | null }> {
  const snapshot = await shareRef(projectId).get();
  const data = snapshot.data() as StoredShare | undefined;
  const token = typeof data?.token === "string" && isValidRehearsalShareToken(data.token) ? data.token : null;
  return { enabled: data?.enabled === true && token !== null, path: data?.enabled === true && token ? buildRehearsalSharePath(token) : null };
}

async function writeShare(projectId: string, uid: string, replace: boolean): Promise<{ enabled: true; path: string }> {
  const projectRef = adminDb.collection("projects").doc(projectId);
  const reference = shareRef(projectId);
  return adminDb.runTransaction(async (transaction) => {
    const [project, current] = await Promise.all([transaction.get(projectRef), transaction.get(reference)]);
    if (!project.exists) throw new Error("project_not_found");
    const currentData = current.data() as StoredShare | undefined;
    if (!replace && currentData?.enabled === true && typeof currentData.token === "string" && isValidRehearsalShareToken(currentData.token)) {
      return { enabled: true as const, path: buildRehearsalSharePath(currentData.token) };
    }
    const token = generateRehearsalShareToken();
    const now = Timestamp.now();
    transaction.set(reference, {
      projectId,
      enabled: true,
      token,
      tokenHash: hashRehearsalShareToken(token),
      createdAt: current.exists ? current.get("createdAt") ?? now : now,
      createdByUid: current.exists ? current.get("createdByUid") ?? uid : uid,
      updatedAt: now,
      updatedByUid: uid,
    });
    return { enabled: true as const, path: buildRehearsalSharePath(token) };
  });
}

export function issueRehearsalShare(projectId: string, uid: string) {
  return writeShare(projectId, uid, false);
}

export function regenerateRehearsalShare(projectId: string, uid: string) {
  return writeShare(projectId, uid, true);
}

export async function disableRehearsalShare(projectId: string, uid: string): Promise<{ enabled: false; path: null }> {
  const reference = shareRef(projectId);
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists || snapshot.data()?.enabled !== true) return;
    transaction.update(reference, {
      enabled: false,
      token: null,
      tokenHash: null,
      updatedAt: Timestamp.now(),
      updatedByUid: uid,
    });
  });
  return { enabled: false, path: null };
}

export async function getPublicRehearsalSchedule(token: string, now = Timestamp.now()): Promise<PublicRehearsalSchedule | null> {
  if (!isValidRehearsalShareToken(token)) return null;
  const shares = await adminDb.collection(SHARE_COLLECTION)
    .where("tokenHash", "==", hashRehearsalShareToken(token))
    .limit(2)
    .get();
  if (shares.size !== 1) return null;
  const share = shares.docs[0];
  const shareData = share.data() as StoredShare;
  if (shareData.enabled !== true || typeof shareData.token !== "string" || !tokensEqual(shareData.token, token)) return null;

  const projectRef = adminDb.collection("projects").doc(share.id);
  const [project, rehearsals] = await Promise.all([
    projectRef.get(),
    projectRef.collection("rehearsals").where("startAt", ">=", now).orderBy("startAt", "asc").limit(100).get(),
  ]);
  if (!project.exists) return null;
  const projectData = project.data() ?? {};
  const items = rehearsals.docs.flatMap((document) => {
    const item = mapPublicRehearsal(document.data());
    return item ? [item] : [];
  });
  const updatedTimes = rehearsals.docs
    .map((document) => toIso(document.data().updatedAt))
    .filter((value): value is string => value !== null)
    .sort();
  const title = [projectData.performanceName, projectData.title].find((value) => typeof value === "string" && value.trim());
  return {
    projectTitle: typeof title === "string" ? title.trim().slice(0, 200) : "公演",
    rehearsals: items,
    updatedAt: updatedTimes.at(-1) ?? toIso(shareData.updatedAt) ?? null,
  };
}
