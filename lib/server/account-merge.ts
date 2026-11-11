import { randomBytes } from "node:crypto";
import type { UserRecord } from "firebase-admin/auth";
import { Timestamp, type DocumentData, type Firestore } from "firebase-admin/firestore";

import {
  assessAccountMerge,
  hashAccountMergeInventory,
  type AccountAuthInventory,
  type AccountMergeInventory,
  type MembershipInventory,
} from "../account-merge.ts";
import { getLineUserLinkId } from "../line-account-link.ts";
import { adminAuth, adminDb } from "./firebase-admin.ts";

const LOCK_LEASE_MS = 2 * 60 * 1000;
const CALENDAR_LEASE_MS = 5 * 60 * 1000;
const ACTIVE_JOB_STATUSES = ["pending", "running", "retry", "waiting_connection"];
const ACTIVE_MAPPING_STATUSES = ["creating", "updating", "deleting"];

const HISTORICAL_UID_FIELDS = new Set([
  "actorUid", "userUid", "createdByUid", "updatedByUid", "reporterUid",
  "invitedByUid", "claimedByUid", "revokedByUid", "cancelledByUid",
  "recipientUid",
]);
const KNOWN_ACTIVE_UID_FIELDS: Record<string, Set<string>> = {
  projects: new Set(["memberUids"]),
  members: new Set(["uid"]),
  people: new Set(["linkedUserUid"]),
  participants: new Set(["linkedUserUid"]),
  tasks: new Set(["assigneeUid"]),
  participantLinkedUsers: new Set(),
};
const KNOWN_TOP_LEVEL_COLLECTIONS = new Set([
  "projects", "categories", "userIntegrations", "lineUserLinks", "lineAuthStates",
  "lineAuthTickets", "lineLoginStates", "lineSignupAttempts", "lineSignupLocks",
  "googleCalendarConnections", "googleCalendarSyncJobs", "googleCalendarOAuthStates",
  "projectInviteLinks", "publicRehearsalShares", "accountMergeAttempts",
  "accountMergeLocks", "accountMergeAliases",
]);

export class AccountMergeError extends Error {
  readonly code: "same_uid" | "auth_user_missing" | "merge_locked";

  constructor(code: "same_uid" | "auth_user_missing" | "merge_locked") {
    super(code);
    this.name = "AccountMergeError";
    this.code = code;
  }
}

type AuthReader = { getUser(uid: string): Promise<UserRecord> };

function authInventory(user: UserRecord): AccountAuthInventory {
  const providers = [...new Set(user.providerData.map((item) => item.providerId))].sort();
  return {
    exists: true,
    disabled: user.disabled,
    providers,
    hasGoogle: providers.includes("google.com"),
    hasEmail: Boolean(user.email),
    hasDisplayName: Boolean(user.displayName),
    hasPhotoUrl: Boolean(user.photoURL),
    creationTime: user.metadata.creationTime || null,
    lastSignInTime: user.metadata.lastSignInTime || null,
  };
}

function timestampMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function isUnexpired(data: DocumentData, nowMillis: number): boolean {
  const expiresAt = timestampMillis(data.expiresAt);
  return expiresAt === null || expiresAt > nowMillis;
}

function memberSide(projectData: DocumentData, member: FirebaseFirestore.DocumentSnapshot) {
  const data = member.data();
  const memberUids = Array.isArray(projectData.memberUids) ? projectData.memberUids : [];
  return {
    inMemberUids: memberUids.includes(member.id),
    memberExists: member.exists,
    role: typeof data?.role === "string" ? data.role : null,
    hasDisplayName: Boolean(data?.displayName),
    hasEmail: Boolean(data?.email),
  };
}

async function collectProjectInventory(project: FirebaseFirestore.QueryDocumentSnapshot, primaryUid: string, secondaryUid: string): Promise<MembershipInventory> {
  const [primaryMember, secondaryMember, primaryPeople, secondaryPeople, primaryParticipants, secondaryParticipants, primaryLink, secondaryLink, primaryTasks, secondaryTasks] = await Promise.all([
    project.ref.collection("members").doc(primaryUid).get(),
    project.ref.collection("members").doc(secondaryUid).get(),
    project.ref.collection("people").where("linkedUserUid", "==", primaryUid).get(),
    project.ref.collection("people").where("linkedUserUid", "==", secondaryUid).get(),
    project.ref.collection("participants").where("linkedUserUid", "==", primaryUid).get(),
    project.ref.collection("participants").where("linkedUserUid", "==", secondaryUid).get(),
    project.ref.collection("participantLinkedUsers").doc(primaryUid).get(),
    project.ref.collection("participantLinkedUsers").doc(secondaryUid).get(),
    project.ref.collection("tasks").where("assigneeUid", "==", primaryUid).get(),
    project.ref.collection("tasks").where("assigneeUid", "==", secondaryUid).get(),
  ]);
  const projectData = project.data();
  return {
    projectId: project.id,
    primary: memberSide(projectData, primaryMember),
    secondary: memberSide(projectData, secondaryMember),
    primaryPersonIds: primaryPeople.docs.map((doc) => doc.id).sort(),
    secondaryPersonIds: secondaryPeople.docs.map((doc) => doc.id).sort(),
    primaryParticipantIds: primaryParticipants.docs.map((doc) => doc.id).sort(),
    secondaryParticipantIds: secondaryParticipants.docs.map((doc) => doc.id).sort(),
    primaryLinkedParticipantId: typeof primaryLink.data()?.participantId === "string" ? primaryLink.data()!.participantId : null,
    secondaryLinkedParticipantId: typeof secondaryLink.data()?.participantId === "string" ? secondaryLink.data()!.participantId : null,
    primaryTaskIds: primaryTasks.docs.map((doc) => doc.id).sort(),
    secondaryTaskIds: secondaryTasks.docs.map((doc) => doc.id).sort(),
  };
}

async function collectLineSide(db: Firestore, uid: string) {
  const [integration, reverseMappings] = await Promise.all([
    db.collection("userIntegrations").doc(uid).collection("providers").doc("line").get(),
    db.collection("lineUserLinks").where("uid", "==", uid).get(),
  ]);
  const lineUserId = typeof integration.data()?.lineUserId === "string" ? integration.data()!.lineUserId : null;
  if (!lineUserId) {
    return {
      linked: !reverseMappings.empty,
      consistent: !integration.exists && reverseMappings.empty,
      identityHash: reverseMappings.size === 1 ? reverseMappings.docs[0].id : null,
    };
  }
  const identityHash = getLineUserLinkId(lineUserId);
  const reverse = await db.collection("lineUserLinks").doc(getLineUserLinkId(lineUserId)).get();
  return {
    linked: true,
    consistent: reverse.exists && reverse.data()?.uid === uid && reverse.data()?.lineUserId === lineUserId
      && reverseMappings.size === 1 && reverseMappings.docs[0].id === identityHash,
    identityHash,
  };
}

async function countActiveByUid(db: Firestore, collection: string, uid: string, nowMillis: number): Promise<number> {
  const snapshot = await db.collection(collection).where("uid", "==", uid).get();
  return snapshot.docs.filter((doc) => doc.data().status === "pending" && isUnexpired(doc.data(), nowMillis)).length;
}

async function countActiveByStatus(
  db: Firestore,
  collection: string,
  statuses: readonly string[],
  nowMillis: number
): Promise<number> {
  const snapshot = await db.collection(collection).get();
  return snapshot.docs.filter((doc) => statuses.includes(String(doc.data().status))
    && isUnexpired(doc.data(), nowMillis)).length;
}

async function scanUnknownProjectReferences(db: Firestore, secondaryUid: string): Promise<string[]> {
  const projects = await db.collection("projects").get();
  const unknown = new Set<string>();
  for (const project of projects.docs) {
    for (const [field, value] of Object.entries(project.data())) {
      if (HISTORICAL_UID_FIELDS.has(field) || KNOWN_ACTIVE_UID_FIELDS.projects.has(field)) continue;
      if (!/Uids?$/.test(field)) continue;
      if (value === secondaryUid || Array.isArray(value) && value.includes(secondaryUid)) {
        unknown.add(`projects.${field}`);
      }
    }
    const collections = await project.ref.listCollections();
    for (const collection of collections) {
      const known = KNOWN_ACTIVE_UID_FIELDS[collection.id] ?? new Set<string>();
      const documents = await collection.get();
      for (const document of documents.docs) {
        for (const [field, value] of Object.entries(document.data())) {
          if (HISTORICAL_UID_FIELDS.has(field) || known.has(field)) continue;
          if (!/Uids?$/.test(field)) continue;
          const matches = value === secondaryUid || Array.isArray(value) && value.includes(secondaryUid);
          if (matches) unknown.add(`${collection.id}.${field}`);
        }
      }
    }
  }
  return [...unknown].sort();
}

async function scanUnknownTopLevelReferences(db: Firestore, secondaryUid: string): Promise<string[]> {
  const unknown = new Set<string>();
  const scanCollection = async (collection: FirebaseFirestore.CollectionReference): Promise<void> => {
    const documents = await collection.get();
    for (const document of documents.docs) {
      for (const [field, value] of Object.entries(document.data())) {
        if (HISTORICAL_UID_FIELDS.has(field) || !/Uids?$/.test(field)) continue;
        if (value === secondaryUid || Array.isArray(value) && value.includes(secondaryUid)) {
          unknown.add(`${collection.id}.${field}`);
        }
      }
      for (const nested of await document.ref.listCollections()) await scanCollection(nested);
    }
  };
  for (const collection of await db.listCollections()) {
    if (!KNOWN_TOP_LEVEL_COLLECTIONS.has(collection.id)) await scanCollection(collection);
  }
  return [...unknown].sort();
}

async function collectCalendarSide(db: Firestore, uid: string) {
  const connection = await db.collection("googleCalendarConnections").doc(uid).get();
  const mappings = await connection.ref.collection("eventMappings").get();
  const provisioning = connection.data()?.calendarProvisioning;
  const provisioningStartedAt = timestampMillis(provisioning?.startedAt);
  const activeProvisioning = provisioning?.status === "creating"
    && provisioningStartedAt !== null && Date.now() - provisioningStartedAt < CALENDAR_LEASE_MS;
  const activeMappings = mappings.docs.filter((doc) => {
    const data = doc.data();
    const startedAt = timestampMillis(data.operationStartedAt ?? data.startedAt);
    return ACTIVE_MAPPING_STATUSES.includes(data.status)
      && (startedAt === null || Date.now() - startedAt < CALENDAR_LEASE_MS);
  }).length;
  return { exists: connection.exists, mappingCount: mappings.size, activeOperations: Number(activeProvisioning) + activeMappings };
}

export async function collectAccountMergeInventory(input: {
  primaryUid: string;
  secondaryUid: string;
  db?: Firestore;
  auth?: AuthReader;
}): Promise<AccountMergeInventory> {
  if (!input.primaryUid || !input.secondaryUid || input.primaryUid === input.secondaryUid) throw new AccountMergeError("same_uid");
  const db = input.db ?? adminDb;
  const auth = input.auth ?? adminAuth;
  let primaryUser: UserRecord;
  let secondaryUser: UserRecord;
  try {
    [primaryUser, secondaryUser] = await Promise.all([auth.getUser(input.primaryUid), auth.getUser(input.secondaryUid)]);
  } catch {
    throw new AccountMergeError("auth_user_missing");
  }
  const projectsSnapshot = await db.collection("projects").get();
  const projects = await Promise.all(projectsSnapshot.docs.map((project) => collectProjectInventory(project, input.primaryUid, input.secondaryUid)));
  const [primaryLine, secondaryLine, primaryCalendar, secondaryCalendar] = await Promise.all([
    collectLineSide(db, input.primaryUid), collectLineSide(db, input.secondaryUid),
    collectCalendarSide(db, input.primaryUid), collectCalendarSide(db, input.secondaryUid),
  ]);
  const nowMillis = Date.now();
  const uidPair = [input.primaryUid, input.secondaryUid];
  const [lineAuthStates, lineLogin, lineTickets, signupAttempts, signupLocks, googleOAuth, jobs, inviteClaims, projectUnknownReferences, topLevelUnknownReferences] = await Promise.all([
    countActiveByStatus(db, "lineAuthStates", ["pending"], nowMillis),
    Promise.all(uidPair.map((uid) => countActiveByUid(db, "lineLoginStates", uid, nowMillis))).then((items) => items.reduce((a, b) => a + b, 0)),
    Promise.all(uidPair.map((uid) => countActiveByUid(db, "lineAuthTickets", uid, nowMillis))).then((items) => items.reduce((a, b) => a + b, 0)),
    Promise.all(uidPair.map((uid) => db.collection("lineSignupAttempts").where("plannedUid", "==", uid).get())).then((sets) => sets.flatMap((set) => set.docs).filter((doc) => ["pending", "creating"].includes(doc.data().status) && isUnexpired(doc.data(), nowMillis)).length),
    Promise.all(uidPair.map((uid) => db.collection("lineSignupLocks").where("uid", "==", uid).get())).then((sets) => sets.flatMap((set) => set.docs).filter((doc) => doc.data().status === "active" && isUnexpired(doc.data(), nowMillis)).length),
    Promise.all(uidPair.map((uid) => db.collection("googleCalendarOAuthStates").where("uid", "==", uid).get())).then((sets) => sets.flatMap((set) => set.docs).filter((doc) => isUnexpired(doc.data(), nowMillis)).length),
    Promise.all(uidPair.map((uid) => db.collection("googleCalendarSyncJobs").where("uid", "==", uid).get())).then((sets) => sets.flatMap((set) => set.docs).filter((doc) => ACTIVE_JOB_STATUSES.includes(doc.data().status)).length),
    countActiveByStatus(db, "projectInviteLinks", ["claiming"], nowMillis),
    scanUnknownProjectReferences(db, input.secondaryUid),
    scanUnknownTopLevelReferences(db, input.secondaryUid),
  ]);
  const unknownActiveReferences = [...new Set([...projectUnknownReferences, ...topLevelUnknownReferences])].sort();
  return {
    primaryUid: input.primaryUid,
    secondaryUid: input.secondaryUid,
    auth: { primary: authInventory(primaryUser), secondary: authInventory(secondaryUser) },
    projects: projects.filter((project) => project.primary.memberExists || project.secondary.memberExists
      || project.primary.inMemberUids || project.secondary.inMemberUids
      || project.primaryPersonIds.length || project.secondaryPersonIds.length
      || project.primaryParticipantIds.length || project.secondaryParticipantIds.length
      || project.primaryLinkedParticipantId || project.secondaryLinkedParticipantId
      || project.primaryTaskIds.length || project.secondaryTaskIds.length),
    line: {
      primaryLinked: primaryLine.linked,
      secondaryLinked: secondaryLine.linked,
      primaryMappingConsistent: primaryLine.consistent,
      secondaryMappingConsistent: secondaryLine.consistent,
      sameLineIdentity: Boolean(primaryLine.identityHash && primaryLine.identityHash === secondaryLine.identityHash),
    },
    calendar: {
      primaryConnection: primaryCalendar.exists,
      secondaryConnection: secondaryCalendar.exists,
      primaryMappingCount: primaryCalendar.mappingCount,
      secondaryMappingCount: secondaryCalendar.mappingCount,
    },
    active: {
      lineAuth: lineAuthStates + lineLogin + lineTickets,
      signup: signupAttempts + signupLocks,
      googleOAuth,
      calendarOperation: jobs + primaryCalendar.activeOperations + secondaryCalendar.activeOperations,
      inviteClaim: inviteClaims,
    },
    unknownActiveReferences,
    historyReferencesExcluded: true,
  };
}

export async function acquireAccountMergeLocks(db: Firestore, input: { attemptId: string; primaryUid: string; secondaryUid: string; now?: Timestamp }): Promise<void> {
  const now = input.now ?? Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + LOCK_LEASE_MS);
  const refs = [input.primaryUid, input.secondaryUid].sort().map((uid) => db.collection("accountMergeLocks").doc(uid));
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    if (snapshots.some((snapshot) => snapshot.exists && (timestampMillis(snapshot.data()?.expiresAt) ?? Number.POSITIVE_INFINITY) > now.toMillis())) {
      throw new AccountMergeError("merge_locked");
    }
    refs.forEach((ref) => transaction.set(ref, { attemptId: input.attemptId, createdAt: now, expiresAt }));
  });
}

export async function releaseAccountMergeLocks(db: Firestore, attemptId: string, uids: string[]): Promise<void> {
  const refs = [...new Set(uids)].map((uid) => db.collection("accountMergeLocks").doc(uid));
  await db.runTransaction(async (transaction) => {
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists && snapshot.data()?.attemptId === attemptId) transaction.delete(refs[index]);
    });
  });
}

export async function createAccountMergeDryRun(input: {
  primaryUid: string;
  secondaryUid: string;
  initiatedByUid: string;
  db?: Firestore;
  auth?: AuthReader;
}) {
  const db = input.db ?? adminDb;
  if (!input.primaryUid || !input.secondaryUid || input.primaryUid === input.secondaryUid) {
    throw new AccountMergeError("same_uid");
  }
  const attemptId = randomBytes(18).toString("base64url");
  await acquireAccountMergeLocks(db, { attemptId, primaryUid: input.primaryUid, secondaryUid: input.secondaryUid });
  const createdAt = Timestamp.now();
  const attemptRef = db.collection("accountMergeAttempts").doc(attemptId);
  try {
    await attemptRef.create({
      primaryUid: input.primaryUid,
      secondaryUid: input.secondaryUid,
      initiatedByUid: input.initiatedByUid,
      status: "inventory",
      createdAt,
      updatedAt: createdAt,
      primaryVerifiedAt: null,
      secondaryVerifiedAt: null,
    });
    const inventory = await collectAccountMergeInventory(input);
    const assessment = assessAccountMerge(inventory);
    const inventoryHash = hashAccountMergeInventory(inventory);
    const now = Timestamp.now();
    const summary = {
      safe: assessment.classification === "safe",
      needsReview: assessment.findings.filter((finding) => finding.classification === "needs_review").length,
      blocked: assessment.findings.filter((finding) => finding.classification === "blocked").length,
      unsupported: assessment.findings.filter((finding) => finding.classification === "unsupported").length,
      projectCount: inventory.projects.length,
    };
    await attemptRef.update({
      status: assessment.classification === "safe"
        ? "ready"
        : assessment.classification === "unsupported" ? "blocked" : assessment.classification,
      updatedAt: now,
      inventoryHash,
      summary,
      reasonCodes: assessment.findings.map((finding) => finding.code),
      plan: assessment.plan,
      historyPolicy: "preserve",
    });
    return { attemptId, inventoryHash, summary, assessment };
  } catch (error) {
    const snapshot = await attemptRef.get();
    if (snapshot.exists && snapshot.data()?.status === "inventory") {
      await attemptRef.update({ status: "blocked", updatedAt: Timestamp.now(), failureCategory: "inventory_failed" });
    }
    throw error;
  } finally {
    await releaseAccountMergeLocks(db, attemptId, [input.primaryUid, input.secondaryUid]);
  }
}
