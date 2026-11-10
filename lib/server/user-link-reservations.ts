import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import {
  findUserLinkReservationMemberByEmail,
  getUserLinkReservationInviteOutcome,
  getUserLinkReservationId,
  isValidUserLinkReservationEmail,
  normalizeUserLinkReservationEmail,
  UserLinkReservationError,
  type UserLinkReservation,
  type UserLinkReservationMutationResult,
} from "../user-link-reservations.ts";
import { buildMemberInvitePayload } from "../member-invites.ts";
import { getLegacyRehearsalParticipationTypes } from "../rehearsal-participation.ts";
import { adminAuth, adminDb } from "./firebase-admin.ts";

const RESERVATIONS = "userLinkReservations";
const RESERVATION_LOCKS = "userLinkReservationLocks";
const MAX_CLAIM_RESERVATIONS = 50;

export type ReservationActor = { uid: string; name: string };

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("/") || normalized.length > 1500) {
    throw new UserLinkReservationError("invalid_request", 400, `${label}が不正です`);
  }
  return normalized;
}

function reservationEmail(value: string): string {
  const email = normalizeUserLinkReservationEmail(value);
  if (!isValidUserLinkReservationEmail(email)) {
    throw new UserLinkReservationError(
      "invalid_request",
      400,
      "有効なメールアドレスを入力してください"
    );
  }
  return email;
}

function actorName(token: DecodedIdToken): string {
  const name = typeof token.name === "string" ? token.name.trim() : "";
  return name || "システム利用者";
}

function activityPayload(actor: ReservationActor, changedFields: string[], now: Timestamp) {
  return {
    actorUid: actor.uid,
    actorName: actor.name,
    action: "update",
    section: "people",
    sectionLabel: "関係者",
    changedFields,
    createdAt: now,
  };
}

function automaticInvitePayload(
  projectId: string,
  projectName: string,
  email: string,
  actor: ReservationActor,
  now: Timestamp
) {
  return {
    ...buildMemberInvitePayload({
      projectId,
      projectName,
      email,
      role: "viewer",
      invitedBy: { uid: actor.uid, displayName: actor.name },
    }, now),
    source: "user_link_reservation" as const,
  };
}

function mapReservation(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot
): UserLinkReservation {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    personId: typeof data.personId === "string" ? data.personId : "",
    email: typeof data.email === "string" ? data.email : "",
    status: data.status === "claimed" || data.status === "cancelled"
      ? data.status
      : "pending",
    createdAt: data.createdAt,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    updatedAt: data.updatedAt,
    updatedByUid: typeof data.updatedByUid === "string" ? data.updatedByUid : "",
    claimedAt: data.claimedAt ?? null,
    claimedByUid: typeof data.claimedByUid === "string" ? data.claimedByUid : null,
    cancelledAt: data.cancelledAt ?? null,
    conflictPersonName: null,
  };
}

export async function verifyUserLinkReservationIdToken(idToken: string): Promise<DecodedIdToken> {
  return adminAuth.verifyIdToken(idToken);
}

export async function getProjectUserLinkReservations(input: {
  uid: string;
  projectId: string;
  personId?: string;
}): Promise<UserLinkReservation[]> {
  const projectId = requiredId(input.projectId, "公演ID");
  const personId = input.personId ? requiredId(input.personId, "関係者ID") : null;
  const projectRef = adminDb.collection("projects").doc(projectId);
  const member = await projectRef.collection("members").doc(input.uid).get();
  if (!member.exists || !["owner", "editor"].includes(member.data()?.role)) {
    throw new UserLinkReservationError("forbidden", 403, "予約情報を表示する権限がありません");
  }
  const [snapshot, members, people] = await Promise.all([
    projectRef.collection(RESERVATIONS).get(),
    projectRef.collection("members").get(),
    projectRef.collection("people").get(),
  ]);
  const memberValues = members.docs.map((document) => ({
    uid: document.id,
    email: typeof document.data().email === "string" ? document.data().email : null,
  }));
  const linkedPersonByUid = new Map(people.docs.flatMap((document) => {
    const linkedUserUid = typeof document.data().linkedUserUid === "string"
      ? document.data().linkedUserUid.trim()
      : "";
    return linkedUserUid ? [[linkedUserUid, document] as const] : [];
  }));
  return snapshot.docs
    .map(mapReservation)
    .filter((reservation) => !personId || reservation.personId === personId)
    .map((reservation) => {
      if (reservation.status !== "pending") return reservation;
      const match = findUserLinkReservationMemberByEmail(memberValues, reservation.email);
      if (match.kind !== "match") return reservation;
      const linkedPerson = linkedPersonByUid.get(match.uid);
      if (!linkedPerson || linkedPerson.id === reservation.personId) return reservation;
      const displayName = typeof linkedPerson.data().displayName === "string"
        ? linkedPerson.data().displayName.trim()
        : "";
      return {
        ...reservation,
        conflictPersonName: displayName || "別の関係者",
      };
    })
    .sort((left, right) => left.email.localeCompare(right.email));
}

type FormalLinkSnapshots = {
  person: FirebaseFirestore.DocumentSnapshot;
  participant: FirebaseFirestore.DocumentSnapshot;
  reverse: FirebaseFirestore.DocumentSnapshot;
  linkedPeople: FirebaseFirestore.QuerySnapshot;
};

function linkedUid(snapshot: FirebaseFirestore.DocumentSnapshot): string {
  return typeof snapshot.data()?.linkedUserUid === "string"
    ? snapshot.data()!.linkedUserUid.trim()
    : "";
}

function memberMatchFromSnapshot(
  members: FirebaseFirestore.QuerySnapshot,
  email: string
) {
  const match = findUserLinkReservationMemberByEmail(
    members.docs.map((document) => ({
      uid: document.id,
      email: typeof document.data().email === "string" ? document.data().email : null,
    })),
    email
  );
  if (match.kind === "ambiguous") {
    throw new UserLinkReservationError(
      "member_email_ambiguous",
      409,
      "同じメールアドレスのシステム利用者が複数いるため紐づけできません"
    );
  }
  return match;
}

function conflictingPersonName(
  linkedPeople: FirebaseFirestore.QuerySnapshot,
  personId: string,
  reversePersonId: string
): string {
  const conflict = linkedPeople.docs.find((document) => document.id !== personId)
    ?? linkedPeople.docs.find((document) => document.id === reversePersonId);
  const displayName = typeof conflict?.data().displayName === "string"
    ? conflict.data().displayName.trim()
    : "";
  return displayName || "別の関係者";
}

function inspectFormalLink(
  snapshots: FormalLinkSnapshots,
  personId: string,
  linkedUserUid: string,
  mode: "management" | "claim" = "management"
): "available" | "already_linked" {
  const personLinkedUid = linkedUid(snapshots.person);
  const participantLinkedUid = linkedUid(snapshots.participant);
  const reversePersonId = typeof snapshots.reverse.data()?.participantId === "string"
    ? snapshots.reverse.data()!.participantId.trim()
    : "";
  const linkedToAnotherPerson = snapshots.linkedPeople.docs.some(
    (document) => document.id !== personId
  );

  if (personLinkedUid && personLinkedUid !== linkedUserUid) {
    if (mode === "claim") {
      throw new UserLinkReservationError(
        "reservation_conflict",
        409,
        "既存のシステム利用者連携と競合しています"
      );
    }
    throw new UserLinkReservationError(
      "person_already_linked",
      409,
      "この関係者はすでに別のシステム利用者と紐づいています"
    );
  }
  if ((participantLinkedUid && participantLinkedUid !== linkedUserUid)
    || (reversePersonId && reversePersonId !== personId)
    || linkedToAnotherPerson) {
    const name = conflictingPersonName(snapshots.linkedPeople, personId, reversePersonId);
    if (mode === "claim") {
      throw new UserLinkReservationError(
        "reservation_conflict",
        409,
        "既存のシステム利用者連携と競合しています"
      );
    }
    throw new UserLinkReservationError(
      "member_already_linked",
      409,
      `このGoogleアカウントはすでに「${name}」さんと紐づいています。別のGoogleアカウントを指定するか、既存の紐づけを解除してください。`
    );
  }

  const personMatches = personLinkedUid === linkedUserUid;
  const participantMatches = participantLinkedUid === linkedUserUid;
  const reverseMatches = reversePersonId === personId;
  if (personMatches || participantMatches || reverseMatches) {
    if (personMatches && participantMatches && reverseMatches) return "already_linked";
    throw new UserLinkReservationError(
      "reservation_conflict",
      409,
      "既存のシステム利用者連携が不整合です"
    );
  }
  return "available";
}

function writeFormalLink(
  transaction: FirebaseFirestore.Transaction,
  projectRef: FirebaseFirestore.DocumentReference,
  snapshots: FormalLinkSnapshots,
  personId: string,
  linkedUserUid: string,
  actor: ReservationActor,
  now: Timestamp,
  activityRef: FirebaseFirestore.DocumentReference,
  activityActorUid = actor.uid
) {
  transaction.update(snapshots.person.ref, {
    linkedUserUid,
    updatedAt: now,
    updatedByUid: actor.uid,
  });
  if (snapshots.participant.exists) {
    transaction.update(snapshots.participant.ref, {
      linkedUserUid,
      updatedAt: now,
      updatedByUid: actor.uid,
    });
  } else {
    transaction.set(
      snapshots.participant.ref,
      participantFromPerson(snapshots.person.data()!, linkedUserUid, actor.uid, now)
    );
  }
  transaction.set(projectRef.collection("participantLinkedUsers").doc(linkedUserUid), {
    participantId: personId,
  });
  transaction.set(activityRef, activityPayload(
    { ...actor, uid: activityActorUid },
    ["システム利用者連携"],
    now
  ));
}

async function readFormalLinkSnapshots(
  transaction: FirebaseFirestore.Transaction,
  projectRef: FirebaseFirestore.DocumentReference,
  person: FirebaseFirestore.DocumentSnapshot,
  personId: string,
  linkedUserUid: string
): Promise<FormalLinkSnapshots> {
  const [participant, reverse, linkedPeople] = await Promise.all([
    transaction.get(projectRef.collection("participants").doc(personId)),
    transaction.get(projectRef.collection("participantLinkedUsers").doc(linkedUserUid)),
    transaction.get(projectRef.collection("people").where("linkedUserUid", "==", linkedUserUid)),
  ]);
  return { person, participant, reverse, linkedPeople };
}

export async function linkProjectPersonToUserInTransaction(input: {
  transaction: FirebaseFirestore.Transaction;
  projectRef: FirebaseFirestore.DocumentReference;
  person: FirebaseFirestore.DocumentSnapshot;
  personId: string;
  linkedUserUid: string;
  actor: ReservationActor;
  now: Timestamp;
  activityRef: FirebaseFirestore.DocumentReference;
  redactActivityActorUid?: boolean;
}): Promise<"linked" | "already_linked"> {
  const snapshots = await readFormalLinkSnapshots(
    input.transaction,
    input.projectRef,
    input.person,
    input.personId,
    input.linkedUserUid
  );
  const state = inspectFormalLink(snapshots, input.personId, input.linkedUserUid, "claim");
  if (state === "available") {
    writeFormalLink(
      input.transaction,
      input.projectRef,
      snapshots,
      input.personId,
      input.linkedUserUid,
      input.actor,
      input.now,
      input.activityRef,
      input.redactActivityActorUid ? "" : input.actor.uid
    );
    return "linked";
  }
  return "already_linked";
}

function reservationActor(
  uid: string,
  member: FirebaseFirestore.DocumentSnapshot
): ReservationActor {
  return {
    uid,
    name: typeof member.data()?.displayName === "string" && member.data()!.displayName.trim()
      ? member.data()!.displayName.trim()
      : "システム利用者",
  };
}

export async function createProjectUserLinkReservation(input: {
  uid: string;
  projectId: string;
  personId: string;
  email: string;
}): Promise<UserLinkReservationMutationResult> {
  const projectId = requiredId(input.projectId, "公演ID");
  const personId = requiredId(input.personId, "関係者ID");
  const email = reservationEmail(input.email);
  const reservationId = getUserLinkReservationId(email);
  const projectRef = adminDb.collection("projects").doc(projectId);
  const reservationRef = projectRef.collection(RESERVATIONS).doc(reservationId);
  const lockRef = projectRef.collection(RESERVATION_LOCKS).doc(personId);
  const personRef = projectRef.collection("people").doc(personId);
  const activityRef = projectRef.collection("activityLogs").doc();
  const inviteActivityRef = projectRef.collection("activityLogs").doc();
  const inviteRef = projectRef.collection("memberInvites").doc(email);

  const result = await adminDb.runTransaction(async (transaction) => {
    const [member, person, reservation, lock, members, project, invite] = await Promise.all([
      transaction.get(projectRef.collection("members").doc(input.uid)),
      transaction.get(personRef),
      transaction.get(reservationRef),
      transaction.get(lockRef),
      transaction.get(projectRef.collection("members")),
      transaction.get(projectRef),
      transaction.get(inviteRef),
    ]);
    const role = member.data()?.role;
    if (!member.exists || (role !== "owner" && role !== "editor")) {
      throw new UserLinkReservationError("forbidden", 403, "この操作を行う権限がありません");
    }
    if (!person.exists) {
      throw new UserLinkReservationError("person_not_found", 404, "関係者が見つかりません");
    }
    if (reservation.exists && reservation.data()?.status === "pending"
      && reservation.data()?.personId !== personId) {
      throw new UserLinkReservationError(
        "email_already_reserved",
        409,
        "このメールアドレスは別の関係者に予約されています"
      );
    }
    if (lock.exists && lock.data()?.reservationId !== reservationId) {
      throw new UserLinkReservationError(
        "person_already_reserved",
        409,
        "この関係者には別のメールアドレスが予約されています"
      );
    }
    const memberMatch = memberMatchFromSnapshot(members, email);
    if (memberMatch.kind === "none"
      && typeof person.data()?.linkedUserUid === "string"
      && person.data()!.linkedUserUid.trim()) {
      throw new UserLinkReservationError(
        "person_already_linked",
        409,
        "この関係者はすでにシステム利用者と連携されています"
      );
    }
    const now = Timestamp.now();
    const actor = reservationActor(input.uid, member);
    if (memberMatch.kind === "match") {
      const formalLink = await readFormalLinkSnapshots(
        transaction,
        projectRef,
        person,
        personId,
        memberMatch.uid
      );
      const state = inspectFormalLink(formalLink, personId, memberMatch.uid);
      if (state === "available") {
        writeFormalLink(
          transaction,
          projectRef,
          formalLink,
          personId,
          memberMatch.uid,
          actor,
          now,
          activityRef
        );
      }
      if (reservation.exists && reservation.data()?.status === "pending") {
        transaction.update(reservationRef, {
          status: "claimed",
          claimedAt: now,
          claimedByUid: memberMatch.uid,
          cancelledAt: null,
          updatedAt: now,
          updatedByUid: input.uid,
        });
        if (lock.exists && lock.data()?.reservationId === reservationId) {
          transaction.delete(lockRef);
        }
      }
      return {
        outcome: state === "already_linked" ? "already_linked" as const : "linked" as const,
        inviteOutcome: "not_needed" as const,
      };
    }

    const samePendingReservation = reservation.exists
      && reservation.data()?.status === "pending"
      && reservation.data()?.personId === personId
      && lock.exists
      && lock.data()?.reservationId === reservationId;
    if (!samePendingReservation) {
      transaction.set(reservationRef, {
        personId,
        email,
        status: "pending",
        createdAt: now,
        createdByUid: input.uid,
        updatedAt: now,
        updatedByUid: input.uid,
        claimedAt: null,
        claimedByUid: null,
        cancelledAt: null,
      });
      transaction.set(lockRef, { reservationId, email, updatedAt: now });
      transaction.set(activityRef, activityPayload(actor, ["システム利用者連携予約を作成"], now));
    }
    const inviteOutcome = getUserLinkReservationInviteOutcome({
      memberExists: false,
      inviteStatus: invite.data()?.status,
    });
    if (inviteOutcome === "created") {
      const projectName = typeof project.data()?.title === "string" ? project.data()!.title : "";
      transaction.set(inviteRef, automaticInvitePayload(projectId, projectName, email, actor, now));
      transaction.set(inviteActivityRef, activityPayload(actor, ["システム利用者招待を作成"], now));
    }
    return { outcome: "pending" as const, inviteOutcome };
  });
  return {
    ...result,
    reservation: result.outcome === "pending" ? mapReservation(await reservationRef.get()) : null,
  };
}

export async function changeProjectUserLinkReservation(input: {
  uid: string;
  projectId: string;
  personId: string;
  email: string;
}): Promise<UserLinkReservationMutationResult> {
  const projectId = requiredId(input.projectId, "公演ID");
  const personId = requiredId(input.personId, "関係者ID");
  const email = reservationEmail(input.email);
  const newReservationId = getUserLinkReservationId(email);
  const projectRef = adminDb.collection("projects").doc(projectId);
  const lockRef = projectRef.collection(RESERVATION_LOCKS).doc(personId);
  const newReservationRef = projectRef.collection(RESERVATIONS).doc(newReservationId);
  const personRef = projectRef.collection("people").doc(personId);
  const activityRef = projectRef.collection("activityLogs").doc();
  const inviteActivityRef = projectRef.collection("activityLogs").doc();
  const inviteRef = projectRef.collection("memberInvites").doc(email);

  const result = await adminDb.runTransaction(async (transaction) => {
    const [member, person, lock, newReservation, members, project, invite] = await Promise.all([
      transaction.get(projectRef.collection("members").doc(input.uid)),
      transaction.get(personRef),
      transaction.get(lockRef),
      transaction.get(newReservationRef),
      transaction.get(projectRef.collection("members")),
      transaction.get(projectRef),
      transaction.get(inviteRef),
    ]);
    const role = member.data()?.role;
    if (!member.exists || (role !== "owner" && role !== "editor")) {
      throw new UserLinkReservationError("forbidden", 403, "この操作を行う権限がありません");
    }
    if (!person.exists) {
      throw new UserLinkReservationError("person_not_found", 404, "関係者が見つかりません");
    }
    const oldReservationId = typeof lock.data()?.reservationId === "string"
      ? lock.data()!.reservationId
      : "";
    if (!lock.exists || !oldReservationId) {
      throw new UserLinkReservationError("reservation_not_found", 404, "変更する予約が見つかりません");
    }
    if (newReservation.exists && newReservation.data()?.status === "pending"
      && newReservation.id !== oldReservationId) {
      throw new UserLinkReservationError(
        "email_already_reserved",
        409,
        "このメールアドレスは別の関係者に予約されています"
      );
    }
    const oldReservationRef = projectRef.collection(RESERVATIONS).doc(oldReservationId);
    const oldReservation = await transaction.get(oldReservationRef);
    if (!oldReservation.exists || oldReservation.data()?.status !== "pending"
      || oldReservation.data()?.personId !== personId) {
      throw new UserLinkReservationError("reservation_conflict", 409, "予約情報が競合しています");
    }

    const memberMatch = memberMatchFromSnapshot(members, email);
    if (memberMatch.kind === "none"
      && typeof person.data()?.linkedUserUid === "string"
      && person.data()!.linkedUserUid.trim()) {
      throw new UserLinkReservationError(
        "person_already_linked",
        409,
        "この関係者はすでにシステム利用者と連携されています"
      );
    }
    const now = Timestamp.now();
    const actor = reservationActor(input.uid, member);
    if (memberMatch.kind === "match") {
      const formalLink = await readFormalLinkSnapshots(
        transaction,
        projectRef,
        person,
        personId,
        memberMatch.uid
      );
      const state = inspectFormalLink(formalLink, personId, memberMatch.uid);
      if (state === "available") {
        writeFormalLink(
          transaction,
          projectRef,
          formalLink,
          personId,
          memberMatch.uid,
          actor,
          now,
          activityRef
        );
      }
      transaction.update(oldReservationRef, oldReservationId === newReservationId ? {
        status: "claimed",
        claimedAt: now,
        claimedByUid: memberMatch.uid,
        cancelledAt: null,
        updatedAt: now,
        updatedByUid: input.uid,
      } : {
        status: "cancelled",
        cancelledAt: now,
        updatedAt: now,
        updatedByUid: input.uid,
      });
      transaction.delete(lockRef);
      return {
        outcome: state === "already_linked" ? "already_linked" as const : "linked" as const,
        inviteOutcome: "not_needed" as const,
      };
    }

    if (oldReservationId === newReservationId) {
      const inviteOutcome = getUserLinkReservationInviteOutcome({
        memberExists: false,
        inviteStatus: invite.data()?.status,
      });
      if (inviteOutcome === "created") {
        const projectName = typeof project.data()?.title === "string" ? project.data()!.title : "";
        transaction.set(inviteRef, automaticInvitePayload(projectId, projectName, email, actor, now));
        transaction.set(inviteActivityRef, activityPayload(actor, ["システム利用者招待を作成"], now));
      }
      return { outcome: "pending" as const, inviteOutcome };
    }

    const oldReservationEmail = reservationEmail(String(oldReservation.data()?.email ?? ""));
    const oldInviteRef = projectRef.collection("memberInvites").doc(oldReservationEmail);
    const oldInvite = await transaction.get(oldInviteRef);

    transaction.update(oldReservationRef, {
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
      updatedByUid: input.uid,
    });
    if (oldInvite.data()?.status === "pending"
      && oldInvite.data()?.source === "user_link_reservation") {
      transaction.update(oldInviteRef, { status: "revoked", updatedAt: now });
    }
    transaction.set(newReservationRef, {
      personId,
      email,
      status: "pending",
      createdAt: now,
      createdByUid: input.uid,
      updatedAt: now,
      updatedByUid: input.uid,
      claimedAt: null,
      claimedByUid: null,
      cancelledAt: null,
    });
    transaction.set(lockRef, { reservationId: newReservationId, email, updatedAt: now });
    transaction.set(activityRef, activityPayload(actor, ["システム利用者連携予約を変更"], now));
    const inviteOutcome = getUserLinkReservationInviteOutcome({
      memberExists: false,
      inviteStatus: invite.data()?.status,
    });
    if (inviteOutcome === "created") {
      const projectName = typeof project.data()?.title === "string" ? project.data()!.title : "";
      transaction.set(inviteRef, automaticInvitePayload(projectId, projectName, email, actor, now));
      transaction.set(inviteActivityRef, activityPayload(actor, ["システム利用者招待を作成"], now));
    }
    return { outcome: "pending" as const, inviteOutcome };
  });
  return {
    ...result,
    reservation: result.outcome === "pending" ? mapReservation(await newReservationRef.get()) : null,
  };
}

export async function cancelProjectUserLinkReservation(input: {
  uid: string;
  projectId: string;
  personId: string;
}): Promise<void> {
  const projectId = requiredId(input.projectId, "公演ID");
  const personId = requiredId(input.personId, "関係者ID");
  const projectRef = adminDb.collection("projects").doc(projectId);
  const lockRef = projectRef.collection(RESERVATION_LOCKS).doc(personId);
  const activityRef = projectRef.collection("activityLogs").doc();

  await adminDb.runTransaction(async (transaction) => {
    const [member, lock] = await Promise.all([
      transaction.get(projectRef.collection("members").doc(input.uid)),
      transaction.get(lockRef),
    ]);
    const role = member.data()?.role;
    if (!member.exists || (role !== "owner" && role !== "editor")) {
      throw new UserLinkReservationError("forbidden", 403, "この操作を行う権限がありません");
    }
    const reservationId = typeof lock.data()?.reservationId === "string"
      ? lock.data()!.reservationId
      : "";
    if (!lock.exists || !reservationId) {
      throw new UserLinkReservationError("reservation_not_found", 404, "取り消す予約が見つかりません");
    }
    const reservationRef = projectRef.collection(RESERVATIONS).doc(reservationId);
    const reservation = await transaction.get(reservationRef);
    if (!reservation.exists || reservation.data()?.status !== "pending"
      || reservation.data()?.personId !== personId) {
      throw new UserLinkReservationError("reservation_conflict", 409, "予約情報が競合しています");
    }
    const email = reservationEmail(String(reservation.data()?.email ?? ""));
    const inviteRef = projectRef.collection("memberInvites").doc(email);
    const invite = await transaction.get(inviteRef);
    const now = Timestamp.now();
    transaction.update(reservationRef, {
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
      updatedByUid: input.uid,
    });
    if (invite.data()?.status === "pending"
      && invite.data()?.source === "user_link_reservation") {
      transaction.update(inviteRef, { status: "revoked", updatedAt: now });
    }
    transaction.delete(lockRef);
    transaction.set(activityRef, activityPayload({
      uid: input.uid,
      name: typeof member.data()?.displayName === "string" && member.data()!.displayName.trim()
        ? member.data()!.displayName.trim()
        : "システム利用者",
    }, ["システム利用者連携予約を解除"], now));
  });
}

function participantFromPerson(
  personData: FirebaseFirestore.DocumentData,
  linkedUserUid: string,
  actorUid: string,
  now: Timestamp
) {
  return {
    displayName: typeof personData.displayName === "string" ? personData.displayName : "",
    specialPractice: typeof personData.specialPractice === "string"
      ? personData.specialPractice
      : "none",
    rehearsalParticipationTypes: Array.isArray(personData.rehearsalParticipationTypes)
      ? personData.rehearsalParticipationTypes
      : getLegacyRehearsalParticipationTypes(personData.specialPractice),
    linkedUserUid,
    publicNote: typeof personData.publicNote === "string" ? personData.publicNote : "",
    active: personData.active === true && personData.attendanceTarget === true,
    createdAt: personData.createdAt ?? now,
    createdByUid: typeof personData.createdByUid === "string" ? personData.createdByUid : actorUid,
    updatedAt: now,
    updatedByUid: actorUid,
  };
}

export async function claimPendingUserLinkReservations(
  token: DecodedIdToken
): Promise<{ claimedCount: number; waitingForMembershipCount: number }> {
  const emailValue = typeof token.email === "string" ? token.email : "";
  const email = reservationEmail(emailValue);
  if (token.email_verified !== true) {
    throw new UserLinkReservationError(
      "email_not_verified",
      403,
      "確認済みのメールアドレスが必要です"
    );
  }
  if (token.firebase?.sign_in_provider !== "google.com") {
    throw new UserLinkReservationError(
      "google_account_required",
      403,
      "Googleアカウントでのログインが必要です"
    );
  }

  const snapshot = await adminDb.collectionGroup(RESERVATIONS)
    .where("email", "==", email)
    .where("status", "==", "pending")
    .get();
  if (snapshot.size > MAX_CLAIM_RESERVATIONS) {
    throw new UserLinkReservationError(
      "ambiguous_reservation",
      409,
      "紐づけ予約が多すぎるため自動連携できません"
    );
  }

  const candidates = snapshot.docs.map((document) => {
    const projectRef = document.ref.parent.parent;
    if (!projectRef || projectRef.parent.id !== "projects") {
      throw new UserLinkReservationError("reservation_conflict", 409, "予約情報が不正です");
    }
    return { document, projectRef, projectId: projectRef.id };
  });
  if (new Set(candidates.map(({ projectId }) => projectId)).size !== candidates.length) {
    throw new UserLinkReservationError(
      "ambiguous_reservation",
      409,
      "同一公演に複数の紐づけ予約があります"
    );
  }

  return adminDb.runTransaction(async (transaction) => {
    const records = [] as Array<{
      reservation: FirebaseFirestore.DocumentSnapshot;
      projectRef: FirebaseFirestore.DocumentReference;
      member: FirebaseFirestore.DocumentSnapshot;
      person: FirebaseFirestore.DocumentSnapshot;
      participant: FirebaseFirestore.DocumentSnapshot;
      reverse: FirebaseFirestore.DocumentSnapshot;
      lock: FirebaseFirestore.DocumentSnapshot;
      linkedPeople: FirebaseFirestore.QuerySnapshot;
    }>;

    for (const candidate of candidates) {
      const reservation = await transaction.get(candidate.document.ref);
      const personId = typeof reservation.data()?.personId === "string"
        ? reservation.data()!.personId.trim()
        : "";
      if (!personId || personId.includes("/")) {
        throw new UserLinkReservationError("reservation_conflict", 409, "予約情報が不正です");
      }
      const [member, person, participant, reverse, lock, linkedPeople] = await Promise.all([
        transaction.get(candidate.projectRef.collection("members").doc(token.uid)),
        transaction.get(candidate.projectRef.collection("people").doc(personId)),
        transaction.get(candidate.projectRef.collection("participants").doc(personId)),
        transaction.get(candidate.projectRef.collection("participantLinkedUsers").doc(token.uid)),
        transaction.get(candidate.projectRef.collection(RESERVATION_LOCKS).doc(personId)),
        transaction.get(candidate.projectRef.collection("people")
          .where("linkedUserUid", "==", token.uid)),
      ]);
      records.push({
        reservation,
        projectRef: candidate.projectRef,
        member,
        person,
        participant,
        reverse,
        lock,
        linkedPeople,
      });
    }

    let claimedCount = 0;
    let waitingForMembershipCount = 0;
    const now = Timestamp.now();
    const actor: ReservationActor = { uid: token.uid, name: actorName(token) };

    for (const record of records) {
      const reservationData = record.reservation.data();
      if (!record.reservation.exists || reservationData?.status !== "pending"
        || normalizeUserLinkReservationEmail(String(reservationData?.email ?? "")) !== email) {
        continue;
      }
      if (!record.member.exists) {
        waitingForMembershipCount += 1;
        continue;
      }
      if (!record.person.exists) {
        throw new UserLinkReservationError("person_not_found", 409, "予約された関係者が見つかりません");
      }
      const personId = String(reservationData.personId);
      const reservationId = record.reservation.id;
      if (!record.lock.exists || record.lock.data()?.reservationId !== reservationId) {
        throw new UserLinkReservationError("reservation_conflict", 409, "予約情報が競合しています");
      }
      const formalLink = {
        person: record.person,
        participant: record.participant,
        reverse: record.reverse,
        linkedPeople: record.linkedPeople,
      };
      const linkState = inspectFormalLink(formalLink, personId, token.uid, "claim");
      if (linkState === "available") {
        writeFormalLink(
          transaction,
          record.projectRef,
          formalLink,
          personId,
          token.uid,
          actor,
          now,
          record.projectRef.collection("activityLogs").doc()
        );
      }
      transaction.update(record.reservation.ref, {
        status: "claimed",
        claimedAt: now,
        claimedByUid: token.uid,
        cancelledAt: null,
        updatedAt: now,
        updatedByUid: token.uid,
      });
      transaction.delete(record.lock.ref);
      claimedCount += 1;
    }
    return { claimedCount, waitingForMembershipCount };
  });
}
