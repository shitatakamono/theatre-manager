import type { DecodedIdToken } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import {
  getUserLinkReservationId,
  isValidUserLinkReservationEmail,
  normalizeUserLinkReservationEmail,
  UserLinkReservationError,
  type UserLinkReservation,
} from "../user-link-reservations.ts";
import { getLegacyRehearsalParticipationTypes } from "../rehearsal-participation.ts";
import { adminAuth, adminDb } from "./firebase-admin.ts";

const RESERVATIONS = "userLinkReservations";
const RESERVATION_LOCKS = "userLinkReservationLocks";
const MAX_CLAIM_RESERVATIONS = 50;

type ReservationActor = { uid: string; name: string };

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
  const snapshot = await projectRef.collection(RESERVATIONS).get();
  return snapshot.docs
    .map(mapReservation)
    .filter((reservation) => !personId || reservation.personId === personId)
    .sort((left, right) => left.email.localeCompare(right.email));
}

export async function createProjectUserLinkReservation(input: {
  uid: string;
  projectId: string;
  personId: string;
  email: string;
}): Promise<UserLinkReservation> {
  const projectId = requiredId(input.projectId, "公演ID");
  const personId = requiredId(input.personId, "関係者ID");
  const email = reservationEmail(input.email);
  const reservationId = getUserLinkReservationId(email);
  const projectRef = adminDb.collection("projects").doc(projectId);
  const reservationRef = projectRef.collection(RESERVATIONS).doc(reservationId);
  const lockRef = projectRef.collection(RESERVATION_LOCKS).doc(personId);
  const personRef = projectRef.collection("people").doc(personId);
  const activityRef = projectRef.collection("activityLogs").doc();

  await adminDb.runTransaction(async (transaction) => {
    const [member, person, reservation, lock] = await Promise.all([
      transaction.get(projectRef.collection("members").doc(input.uid)),
      transaction.get(personRef),
      transaction.get(reservationRef),
      transaction.get(lockRef),
    ]);
    const role = member.data()?.role;
    if (!member.exists || (role !== "owner" && role !== "editor")) {
      throw new UserLinkReservationError("forbidden", 403, "この操作を行う権限がありません");
    }
    if (!person.exists) {
      throw new UserLinkReservationError("person_not_found", 404, "関係者が見つかりません");
    }
    if (typeof person.data()?.linkedUserUid === "string" && person.data()!.linkedUserUid.trim()) {
      throw new UserLinkReservationError(
        "person_already_linked",
        409,
        "この関係者はすでにシステム利用者と連携されています"
      );
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
    if (reservation.exists && reservation.data()?.status === "pending") {
      throw new UserLinkReservationError(
        "email_already_reserved",
        409,
        "このメールアドレスはすでに予約されています"
      );
    }

    const now = Timestamp.now();
    const actor = {
      uid: input.uid,
      name: typeof member.data()?.displayName === "string" && member.data()!.displayName.trim()
        ? member.data()!.displayName.trim()
        : "システム利用者",
    };
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
  });
  return mapReservation(await reservationRef.get());
}

export async function changeProjectUserLinkReservation(input: {
  uid: string;
  projectId: string;
  personId: string;
  email: string;
}): Promise<UserLinkReservation> {
  const projectId = requiredId(input.projectId, "公演ID");
  const personId = requiredId(input.personId, "関係者ID");
  const email = reservationEmail(input.email);
  const newReservationId = getUserLinkReservationId(email);
  const projectRef = adminDb.collection("projects").doc(projectId);
  const lockRef = projectRef.collection(RESERVATION_LOCKS).doc(personId);
  const newReservationRef = projectRef.collection(RESERVATIONS).doc(newReservationId);
  const personRef = projectRef.collection("people").doc(personId);
  const activityRef = projectRef.collection("activityLogs").doc();

  await adminDb.runTransaction(async (transaction) => {
    const [member, person, lock, newReservation] = await Promise.all([
      transaction.get(projectRef.collection("members").doc(input.uid)),
      transaction.get(personRef),
      transaction.get(lockRef),
      transaction.get(newReservationRef),
    ]);
    const role = member.data()?.role;
    if (!member.exists || (role !== "owner" && role !== "editor")) {
      throw new UserLinkReservationError("forbidden", 403, "この操作を行う権限がありません");
    }
    if (!person.exists) {
      throw new UserLinkReservationError("person_not_found", 404, "関係者が見つかりません");
    }
    if (typeof person.data()?.linkedUserUid === "string" && person.data()!.linkedUserUid.trim()) {
      throw new UserLinkReservationError(
        "person_already_linked",
        409,
        "この関係者はすでにシステム利用者と連携されています"
      );
    }
    const oldReservationId = typeof lock.data()?.reservationId === "string"
      ? lock.data()!.reservationId
      : "";
    if (!lock.exists || !oldReservationId) {
      throw new UserLinkReservationError("reservation_not_found", 404, "変更する予約が見つかりません");
    }
    if (oldReservationId === newReservationId) {
      throw new UserLinkReservationError("reservation_conflict", 409, "同じメールアドレスが指定されています");
    }
    if (newReservation.exists && newReservation.data()?.status === "pending") {
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

    const now = Timestamp.now();
    transaction.update(oldReservationRef, {
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
      updatedByUid: input.uid,
    });
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
    transaction.set(activityRef, activityPayload({
      uid: input.uid,
      name: typeof member.data()?.displayName === "string" && member.data()!.displayName.trim()
        ? member.data()!.displayName.trim()
        : "システム利用者",
    }, ["システム利用者連携予約を変更"], now));
  });
  return mapReservation(await newReservationRef.get());
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
    const now = Timestamp.now();
    transaction.update(reservationRef, {
      status: "cancelled",
      cancelledAt: now,
      updatedAt: now,
      updatedByUid: input.uid,
    });
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
  uid: string,
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
    linkedUserUid: uid,
    publicNote: typeof personData.publicNote === "string" ? personData.publicNote : "",
    active: personData.active === true && personData.attendanceTarget === true,
    createdAt: personData.createdAt ?? now,
    createdByUid: typeof personData.createdByUid === "string" ? personData.createdByUid : uid,
    updatedAt: now,
    updatedByUid: uid,
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
      const personLinkedUid = typeof record.person.data()?.linkedUserUid === "string"
        ? record.person.data()!.linkedUserUid.trim()
        : "";
      const participantLinkedUid = typeof record.participant.data()?.linkedUserUid === "string"
        ? record.participant.data()!.linkedUserUid.trim()
        : "";
      const reversePersonId = typeof record.reverse.data()?.participantId === "string"
        ? record.reverse.data()!.participantId.trim()
        : "";
      const linkedToAnotherPerson = record.linkedPeople.docs.some(
        (document) => document.id !== personId
      );
      if ((personLinkedUid && personLinkedUid !== token.uid)
        || (participantLinkedUid && participantLinkedUid !== token.uid)
        || (reversePersonId && reversePersonId !== personId)
        || linkedToAnotherPerson) {
        throw new UserLinkReservationError(
          "reservation_conflict",
          409,
          "既存のシステム利用者連携と競合しています"
        );
      }
      if ((personLinkedUid === token.uid) !== (reversePersonId === personId)) {
        throw new UserLinkReservationError(
          "reservation_conflict",
          409,
          "既存のシステム利用者連携が不整合です"
        );
      }

      transaction.update(record.person.ref, {
        linkedUserUid: token.uid,
        updatedAt: now,
        updatedByUid: token.uid,
      });
      if (record.participant.exists) {
        transaction.update(record.participant.ref, {
          linkedUserUid: token.uid,
          updatedAt: now,
          updatedByUid: token.uid,
        });
      } else {
        transaction.set(
          record.participant.ref,
          participantFromPerson(record.person.data()!, token.uid, now)
        );
      }
      transaction.set(record.projectRef.collection("participantLinkedUsers").doc(token.uid), {
        participantId: personId,
      });
      transaction.update(record.reservation.ref, {
        status: "claimed",
        claimedAt: now,
        claimedByUid: token.uid,
        cancelledAt: null,
        updatedAt: now,
        updatedByUid: token.uid,
      });
      transaction.delete(record.lock.ref);
      transaction.set(
        record.projectRef.collection("activityLogs").doc(),
        activityPayload(actor, ["システム利用者連携"], now)
      );
      claimedCount += 1;
    }
    return { claimedCount, waitingForMembershipCount };
  });
}
