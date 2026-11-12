import type { Auth, UserRecord } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";

import {
  LineInviteSignupError,
  generateLineOnlyFirebaseUid,
  getLineInviteSignupId,
} from "../line-invite-signup.ts";
import {
  LINE_AUTH_TICKET_TTL_MS,
  generateLineAuthTicket,
  getLineAuthTicketId,
} from "../line-auth.ts";
import { getLineUserLinkId, LineAccountLinkError } from "../line-account-link.ts";
import { UserLinkReservationError } from "../user-link-reservations.ts";
import { adminAuth, adminDb } from "./firebase-admin.ts";
import {
  prepareLineAccountLinkInTransaction,
  writePreparedLineAccountLink,
} from "./line-account-link.ts";
import { linkProjectPersonToUserInTransaction } from "./user-link-reservations.ts";
import {
  lineLinkEventId,
  writeLineLinkEvent,
} from "./line-link-events.ts";

const ATTEMPTS = "lineSignupAttempts";
const LOCKS = "lineSignupLocks";
const INVITES = "projectInviteLinks";
const TICKETS = "lineAuthTickets";

function signupRef(token: string) {
  return adminDb.collection(ATTEMPTS).doc(getLineInviteSignupId(token));
}

function displayName(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 128)
    : "LINE利用者";
}

function activity(fields: string[], name: string, now: Timestamp) {
  return {
    actorName: name,
    action: "update",
    section: "members",
    sectionLabel: "システム利用者",
    changedFields: fields,
    createdAt: now,
  };
}

export async function previewLineInviteSignup(token: string): Promise<{
  projectName: string;
  displayName: string | null;
  personName: string | null;
  existingAccountRequired: boolean;
} | null> {
  let attemptReference;
  try { attemptReference = signupRef(token); } catch { return null; }
  const attempt = await attemptReference.get();
  const data = attempt.data();
  if (!attempt.exists || !["pending", "creating"].includes(String(data?.status))
    || !(data?.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= Date.now()) return null;
  const inviteId = typeof data.inviteId === "string" ? data.inviteId : "";
  const invite = inviteId ? await adminDb.collection(INVITES).doc(inviteId).get() : null;
  const inviteData = invite?.data();
  if (!invite?.exists || inviteData?.role !== "viewer"
    || !["pending", "claiming"].includes(String(inviteData.status))) return null;
  const projectId = typeof inviteData.projectId === "string" ? inviteData.projectId : "";
  const project = projectId ? await adminDb.collection("projects").doc(projectId).get() : null;
  if (!project?.exists) return null;
  const personId = typeof inviteData.personId === "string" ? inviteData.personId : "";
  const person = personId
    ? await adminDb.collection("projects").doc(projectId).collection("people").doc(personId).get()
    : null;
  if (personId && (!person?.exists || person.data()?.active !== true)) return null;
  const linkedUserUid = typeof person?.data()?.linkedUserUid === "string"
    ? person.data()!.linkedUserUid.trim()
    : "";
  const title = [project.data()?.performanceName, project.data()?.title]
    .find((value) => typeof value === "string" && value.trim());
  return {
    projectName: typeof title === "string" ? title.trim().slice(0, 200) : "公演",
    displayName: typeof data.displayName === "string" && data.displayName.trim()
      ? data.displayName.trim().slice(0, 128)
      : null,
    personName: personId
      ? String(person?.data()?.displayName ?? "").trim().slice(0, 128) || "関係者"
      : null,
    existingAccountRequired: Boolean(linkedUserUid),
  };
}

type ReservedSignup = {
  attemptId: string;
  inviteId: string;
  lineUserId: string;
  uid: string;
  displayName: string;
  photoURL?: string;
};

async function reserveSignup(token: string): Promise<ReservedSignup> {
  const attemptReference = signupRef(token);
  const generatedUid = generateLineOnlyFirebaseUid();
  return adminDb.runTransaction(async (transaction) => {
    const attempt = await transaction.get(attemptReference);
    const data = attempt.data();
    if (!attempt.exists || !data) throw new LineInviteSignupError("signup_not_found", 404);
    if (!(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= Date.now()) {
      throw new LineInviteSignupError("signup_expired", 410);
    }
    const inviteId = typeof data.inviteId === "string" ? data.inviteId : "";
    const lineUserId = typeof data.lineUserId === "string" ? data.lineUserId : "";
    if (!inviteId || !lineUserId) throw new LineInviteSignupError("signup_invalid");
    const inviteRef = adminDb.collection(INVITES).doc(inviteId);
    const reverseRef = adminDb.collection("lineUserLinks").doc(getLineUserLinkId(lineUserId));
    const lockRef = adminDb.collection(LOCKS).doc(getLineUserLinkId(lineUserId));
    const [invite, reverse, lock] = await Promise.all([
      transaction.get(inviteRef), transaction.get(reverseRef), transaction.get(lockRef),
    ]);
    if (reverse.exists) throw new LineInviteSignupError("line_already_linked");
    if (data.status === "creating") {
      const uid = typeof data.plannedUid === "string" ? data.plannedUid : "";
      if (!uid || lock.data()?.attemptId !== attempt.id
        || invite.data()?.status !== "claiming" || invite.data()?.claimingAttemptId !== attempt.id) {
        throw new LineInviteSignupError("signup_inconsistent");
      }
      return {
        attemptId: attempt.id, inviteId, lineUserId, uid,
        displayName: displayName(data.displayName),
        ...(typeof data.photoURL === "string" ? { photoURL: data.photoURL } : {}),
      };
    }
    if (data.status !== "pending") throw new LineInviteSignupError("signup_not_pending");
    const inviteData = invite.data();
    if (!invite.exists || inviteData?.role !== "viewer" || inviteData.status !== "pending"
      || !(inviteData.expiresAt instanceof Timestamp) || inviteData.expiresAt.toMillis() <= Date.now()) {
      throw new LineInviteSignupError("invite_unavailable");
    }
    if (lock.exists) throw new LineInviteSignupError("signup_in_progress");
    const projectId = typeof inviteData.projectId === "string" ? inviteData.projectId : "";
    const personId = typeof inviteData.personId === "string" ? inviteData.personId : "";
    if (personId) {
      const person = await transaction.get(
        adminDb.collection("projects").doc(projectId).collection("people").doc(personId)
      );
      if (!person.exists || person.data()?.active !== true) {
        throw new LineInviteSignupError("person_conflict", 409);
      }
      const linkedUserUid = typeof person.data()?.linkedUserUid === "string"
        ? person.data()!.linkedUserUid.trim()
        : "";
      if (linkedUserUid) throw new LineInviteSignupError("existing_account_required", 409);
    }
    const now = Timestamp.now();
    transaction.create(lockRef, {
      attemptId: attempt.id, inviteId, status: "active", createdAt: now, expiresAt: data.expiresAt,
    });
    transaction.update(inviteRef, {
      status: "claiming", claimingAttemptId: attempt.id, claimingAt: now,
    });
    transaction.update(attemptReference, {
      status: "creating", plannedUid: generatedUid, reservedAt: now, termsAcceptedAt: now,
    });
    return {
      attemptId: attempt.id, inviteId, lineUserId, uid: generatedUid,
      displayName: displayName(data.displayName),
      ...(typeof data.photoURL === "string" ? { photoURL: data.photoURL } : {}),
    };
  });
}

async function releaseReservation(reserved: ReservedSignup, status: "pending" | "failed") {
  const attemptRef = adminDb.collection(ATTEMPTS).doc(reserved.attemptId);
  const inviteRef = adminDb.collection(INVITES).doc(reserved.inviteId);
  const lockRef = adminDb.collection(LOCKS).doc(getLineUserLinkId(reserved.lineUserId));
  await adminDb.runTransaction(async (transaction) => {
    const [attempt, invite, lock] = await Promise.all([
      transaction.get(attemptRef), transaction.get(inviteRef), transaction.get(lockRef),
    ]);
    if (attempt.data()?.status !== "creating" || lock.data()?.attemptId !== reserved.attemptId) return;
    transaction.update(attemptRef, {
      status,
      ...(status === "pending" ? { plannedUid: null, reservedAt: null } : { failedAt: Timestamp.now() }),
    });
    transaction.delete(lockRef);
    if (invite.data()?.status === "claiming" && invite.data()?.claimingAttemptId === reserved.attemptId) {
      transaction.update(inviteRef, { status: "pending", claimingAttemptId: null, claimingAt: null });
    }
  });
}

async function ensureFirebaseUser(
  auth: Pick<Auth, "createUser" | "getUser">,
  reserved: ReservedSignup
): Promise<UserRecord> {
  try {
    return await auth.createUser({
      uid: reserved.uid,
      displayName: reserved.displayName,
      ...(reserved.photoURL ? { photoURL: reserved.photoURL } : {}),
    });
  } catch {
    try {
      return await auth.getUser(reserved.uid);
    } catch (verificationError) {
      const code = typeof verificationError === "object" && verificationError !== null && "code" in verificationError
        ? String(verificationError.code)
        : "";
      if (code === "auth/user-not-found") {
        await releaseReservation(reserved, "pending");
        throw new LineInviteSignupError("firebase_user_creation_failed", 503);
      }
      throw new LineInviteSignupError("firebase_user_creation_unknown", 503);
    }
  }
}

async function compensateFirebaseUser(
  auth: Pick<Auth, "deleteUser">,
  reserved: ReservedSignup
) {
  const [attempt, integration, reverse, memberships] = await Promise.all([
    adminDb.collection(ATTEMPTS).doc(reserved.attemptId).get(),
    adminDb.collection("userIntegrations").doc(reserved.uid).collection("providers").doc("line").get(),
    adminDb.collection("lineUserLinks").doc(getLineUserLinkId(reserved.lineUserId)).get(),
    adminDb.collectionGroup("members").where("uid", "==", reserved.uid).limit(1).get(),
  ]);
  const reverseUid = typeof reverse.data()?.uid === "string" ? reverse.data()!.uid : "";
  if (attempt.data()?.status !== "failed" || attempt.data()?.plannedUid !== reserved.uid
    || integration.exists || reverseUid === reserved.uid || !memberships.empty) return;
  try { await auth.deleteUser(reserved.uid); } catch { /* Keep the failed attempt for manual recovery. */ }
}

async function finalizeSignup(reserved: ReservedSignup, ticket: string) {
  const attemptRef = adminDb.collection(ATTEMPTS).doc(reserved.attemptId);
  const inviteRef = adminDb.collection(INVITES).doc(reserved.inviteId);
  const lockRef = adminDb.collection(LOCKS).doc(getLineUserLinkId(reserved.lineUserId));
  const ticketRef = adminDb.collection(TICKETS).doc(getLineAuthTicketId(ticket));
  return adminDb.runTransaction(async (transaction) => {
    const [attempt, invite, lock, ticketSnapshot] = await Promise.all([
      transaction.get(attemptRef), transaction.get(inviteRef),
      transaction.get(lockRef), transaction.get(ticketRef),
    ]);
    if (ticketSnapshot.exists) throw new LineInviteSignupError("ticket_collision", 503);
    if (attempt.data()?.status !== "creating" || attempt.data()?.plannedUid !== reserved.uid
      || lock.data()?.attemptId !== reserved.attemptId) throw new LineInviteSignupError("signup_inconsistent");
    const inviteData = invite.data();
    if (!invite.exists || inviteData?.status !== "claiming"
      || inviteData.claimingAttemptId !== reserved.attemptId || inviteData.role !== "viewer"
      || !(inviteData.expiresAt instanceof Timestamp) || inviteData.expiresAt.toMillis() <= Date.now()) {
      throw new LineInviteSignupError("invite_conflict");
    }
    const projectId = typeof inviteData.projectId === "string" ? inviteData.projectId : "";
    const projectRef = adminDb.collection("projects").doc(projectId);
    const memberRef = projectRef.collection("members").doc(reserved.uid);
    const personId = typeof inviteData.personId === "string" ? inviteData.personId : null;
    const personRef = personId ? projectRef.collection("people").doc(personId) : null;
    const [project, member, person] = await Promise.all([
      transaction.get(projectRef), transaction.get(memberRef),
      personRef ? transaction.get(personRef) : Promise.resolve(null),
    ]);
    if (!project.exists) throw new LineInviteSignupError("project_not_found", 404);
    const memberUids = Array.isArray(project.data()?.memberUids) ? project.data()!.memberUids as unknown[] : [];
    if (member.exists !== memberUids.includes(reserved.uid)) throw new LineInviteSignupError("membership_inconsistent");
    if (personRef && (!person?.exists || person.data()?.active !== true)) {
      throw new LineInviteSignupError("person_conflict");
    }

    const preparedLine = await prepareLineAccountLinkInTransaction(
      transaction, reserved.uid, reserved.lineUserId
    );
    const now = Timestamp.now();
    const linkEventId = person && personId
      ? lineLinkEventId(reserved.attemptId, projectId, personId)
      : null;
    if (person && personId) {
      await linkProjectPersonToUserInTransaction({
        transaction, projectRef, person, personId, linkedUserUid: reserved.uid,
        actor: { uid: reserved.uid, name: reserved.displayName }, now,
        activityRef: projectRef.collection("activityLogs").doc(),
        redactActivityActorUid: true,
      });
      writeLineLinkEvent(transaction, {
        projectRef, eventId: linkEventId!, eventType: "linked", personId,
        personName: String(person.data()?.displayName ?? "関係者"),
        lineDisplayName: reserved.displayName, source: "invite_signup", occurredAt: now,
      });
    }
    writePreparedLineAccountLink(transaction, preparedLine, {
      uid: reserved.uid, lineUserId: reserved.lineUserId, now, deliveryStatus: "unknown",
      lineDisplayName: reserved.displayName,
    });
    if (!member.exists) {
      transaction.update(projectRef, { memberUids: [...memberUids, reserved.uid] });
      transaction.create(memberRef, {
        uid: reserved.uid, role: "viewer", displayName: reserved.displayName,
        joinedAt: now, profileUpdatedAt: now,
      });
    }
    transaction.update(inviteRef, {
      status: "claimed", claimedAt: now, claimedByUid: reserved.uid,
      claimingAttemptId: null, claimingAt: null,
    });
    transaction.update(attemptRef, { status: "completed", completedAt: now });
    transaction.delete(lockRef);
    transaction.create(ticketRef, {
      uid: reserved.uid, status: "pending", createdAt: now,
      expiresAt: Timestamp.fromMillis(now.toMillis() + LINE_AUTH_TICKET_TTL_MS), consumedAt: null,
    });
    transaction.create(projectRef.collection("activityLogs").doc(), activity(
      ["LINE招待から新規利用開始"], reserved.displayName, now
    ));
    transaction.create(projectRef.collection("activityLogs").doc(), activity(
      [personId ? "関係者指定招待から参加" : "招待リンクから参加"], reserved.displayName, now
    ));
    return { ticket, projectId, linkEventId };
  });
}

export async function completeLineInviteSignup(
  token: string,
  auth: Pick<Auth, "createUser" | "getUser" | "deleteUser"> = adminAuth
): Promise<{ ticket: string; projectId: string }> {
  const reserved = await reserveSignup(token);
  await ensureFirebaseUser(auth, reserved);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await finalizeSignup(reserved, generateLineAuthTicket());
      return { ticket: result.ticket, projectId: result.projectId };
    } catch (error) {
      if (error instanceof LineInviteSignupError && error.code === "ticket_collision") continue;
      const permanentCode = error instanceof LineInviteSignupError && [
        "invite_conflict", "project_not_found", "membership_inconsistent", "person_conflict",
        "signup_inconsistent", "line_already_linked", "signup_conflict",
      ].includes(error.code);
      if (error instanceof UserLinkReservationError || error instanceof LineAccountLinkError || permanentCode) {
        await releaseReservation(reserved, "failed");
        await compensateFirebaseUser(auth, reserved);
        throw new LineInviteSignupError("signup_conflict");
      }
      throw error;
    }
  }
  throw new LineInviteSignupError("ticket_generation_failed", 503);
}
