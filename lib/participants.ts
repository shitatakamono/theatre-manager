import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type Firestore,
  type QueryDocumentSnapshot,
  type Transaction,
} from "firebase/firestore";
import { getActivityActorName, type ActivityActor } from "./activity.ts";
import {
  buildRehearsalParticipationTypes,
  normalizeRehearsalParticipationTypes,
  type RehearsalParticipationType,
} from "./rehearsal-participation.ts";

export const SPECIAL_PRACTICE_OPTIONS = [
  { value: "none", label: "特別稽古なし" },
  { value: "stage_combat", label: "殺陣" },
  { value: "japanese_dance", label: "日舞" },
] as const;

export type SpecialPractice = (typeof SPECIAL_PRACTICE_OPTIONS)[number]["value"];

export const SPECIAL_PRACTICE_LABELS = Object.fromEntries(
  SPECIAL_PRACTICE_OPTIONS.map(({ value, label }) => [value, label])
) as Record<SpecialPractice, string>;

export type ParticipantInput = {
  displayName: string;
  specialPractice: SpecialPractice;
  rehearsalParticipationTypes?: readonly RehearsalParticipationType[];
  linkedUserUid: string | null;
  publicNote: string;
  active: boolean;
};

export type ParticipantValues = Omit<ParticipantInput, "rehearsalParticipationTypes"> & {
  rehearsalParticipationTypes: RehearsalParticipationType[];
};

export type Participant = ParticipantValues & {
  id: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid: string;
  updatedByUid: string;
};

export const EMPTY_PARTICIPANT_INPUT: ParticipantInput = {
  displayName: "",
  specialPractice: "none",
  rehearsalParticipationTypes: [],
  linkedUserUid: null,
  publicNote: "",
  active: true,
};

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

export function buildParticipantValues(input: ParticipantInput): ParticipantValues {
  const displayName = input.displayName.trim();
  if (!displayName) throw new Error("氏名を入力してください");
  if (displayName.length > 100) throw new Error("氏名は100文字以内で入力してください");
  if (!SPECIAL_PRACTICE_OPTIONS.some(({ value }) => value === input.specialPractice)) {
    throw new Error("特別稽古の指定が不正です");
  }
  const rehearsalParticipationTypes = buildRehearsalParticipationTypes(
    input.rehearsalParticipationTypes,
    input.specialPractice
  );
  const linkedUserUid = input.linkedUserUid?.trim() || null;
  if (linkedUserUid && linkedUserUid.length > 128) throw new Error("アカウント情報が不正です");
  const publicNote = input.publicNote.trim();
  if (publicNote.length > 2000) throw new Error("公開備考は2000文字以内で入力してください");
  if (typeof input.active !== "boolean") throw new Error("参加状態が不正です");
  return {
    displayName,
    specialPractice: input.specialPractice,
    rehearsalParticipationTypes,
    linkedUserUid,
    publicNote,
    active: input.active,
  };
}

export function findLinkedUserDuplicate(
  participants: readonly Pick<Participant, "id" | "linkedUserUid">[],
  linkedUserUid: string | null,
  currentParticipantId?: string
): Participant["id"] | null {
  if (!linkedUserUid) return null;
  return participants.find((participant) => participant.id !== currentParticipantId
    && participant.linkedUserUid === linkedUserUid)?.id ?? null;
}

export function getParticipantChangedFields(before: ParticipantValues, after: ParticipantValues): string[] {
  const changed: string[] = [];
  if (before.displayName !== after.displayName) changed.push("氏名");
  if (before.specialPractice !== after.specialPractice) changed.push("特別稽古");
  if (before.rehearsalParticipationTypes.join("|") !== after.rehearsalParticipationTypes.join("|")) {
    changed.push("参加する稽古");
  }
  if (before.linkedUserUid !== after.linkedUserUid) changed.push("アカウント紐付け");
  if (before.publicNote !== after.publicNote) changed.push("公開備考");
  if (before.active !== after.active) changed.push(after.active ? "参加再開" : "参加終了");
  return changed;
}

function mapParticipant(snapshot: QueryDocumentSnapshot): Participant {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    specialPractice: SPECIAL_PRACTICE_OPTIONS.some(({ value }) => value === data.specialPractice)
      ? data.specialPractice as SpecialPractice
      : "none",
    rehearsalParticipationTypes: normalizeRehearsalParticipationTypes(
      data.rehearsalParticipationTypes,
      data.specialPractice
    ),
    linkedUserUid: typeof data.linkedUserUid === "string" ? data.linkedUserUid : null,
    publicNote: typeof data.publicNote === "string" ? data.publicNote : "",
    active: data.active !== false,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    updatedByUid: typeof data.updatedByUid === "string" ? data.updatedByUid : "",
  };
}

function activityPayload(actor: ActivityActor, action: "create" | "update", changedFields: string[]) {
  return {
    actorUid: actor.uid,
    actorName: getActivityActorName(actor),
    action,
    section: "participants",
    sectionLabel: "参加者管理",
    changedFields,
    createdAt: serverTimestamp(),
  };
}

function personSyncValues(values: ParticipantValues, actorUid: string) {
  return {
    displayName: values.displayName,
    attendanceTarget: values.active,
    specialPractice: values.specialPractice,
    rehearsalParticipationTypes: values.rehearsalParticipationTypes,
    linkedUserUid: values.linkedUserUid,
    publicNote: values.publicNote,
    active: values.active,
    updatedAt: serverTimestamp(),
    updatedByUid: actorUid,
  };
}

export async function synchronizeParticipantLinkedUser(
  transaction: Transaction,
  projectRef: DocumentReference,
  participantId: string,
  currentLinkedUserUid: string | null,
  nextLinkedUserUid: string | null
): Promise<void> {
  if (currentLinkedUserUid === nextLinkedUserUid) return;

  const oldLinkedUserRef = currentLinkedUserUid
    ? doc(projectRef, "participantLinkedUsers", currentLinkedUserUid)
    : null;
  const newLinkedUserRef = nextLinkedUserUid
    ? doc(projectRef, "participantLinkedUsers", nextLinkedUserUid)
    : null;

  if (newLinkedUserRef && nextLinkedUserUid) {
    const memberRef = doc(projectRef, "members", nextLinkedUserUid);
    const [member, linkedUser] = await Promise.all([
      transaction.get(memberRef),
      transaction.get(newLinkedUserRef),
    ]);
    if (!member.exists()) throw new Error("このシステム利用者は公演メンバーではありません");
    if (linkedUser.exists() && linkedUser.data().participantId !== participantId) {
      throw new Error("このアカウントは別の参加者または関係者に紐付いています");
    }
  }

  if (oldLinkedUserRef) transaction.delete(oldLinkedUserRef);
  if (newLinkedUserRef) transaction.set(newLinkedUserRef, { participantId });
}

export async function getProjectParticipants(projectId: string, firestore?: Firestore): Promise<Participant[]> {
  const database = await resolveFirestore(firestore);
  const snapshot = await getDocs(collection(database, "projects", projectId, "participants"));
  return snapshot.docs
    .map(mapParticipant)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja"));
}

export async function createProjectParticipant(
  projectId: string,
  input: ParticipantInput,
  actor: ActivityActor,
  firestore?: Firestore
): Promise<string> {
  const values = buildParticipantValues(input);
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const participantRef = doc(collection(projectRef, "participants"));
  const activityRef = doc(collection(projectRef, "activityLogs"));

  await runTransaction(database, async (transaction) => {
    await synchronizeParticipantLinkedUser(
      transaction,
      projectRef,
      participantRef.id,
      null,
      values.linkedUserUid
    );
    transaction.set(participantRef, {
      ...values,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
    });
    transaction.set(activityRef, activityPayload(actor, "create", [`参加者を追加（${values.displayName}）`]));
  });
  return participantRef.id;
}

export async function updateProjectParticipant(
  projectId: string,
  participantId: string,
  input: ParticipantInput,
  actor: ActivityActor,
  firestore?: Firestore
): Promise<boolean> {
  const values = buildParticipantValues(input);
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const participantRef = doc(projectRef, "participants", participantId);
  const personRef = doc(projectRef, "people", participantId);
  const activityRef = doc(collection(projectRef, "activityLogs"));

  return runTransaction(database, async (transaction) => {
    const [participantSnapshot, personSnapshot] = await Promise.all([
      transaction.get(participantRef),
      transaction.get(personRef),
    ]);
    if (!participantSnapshot.exists()) throw new Error("参加者が見つかりません");
    const current = mapParticipant(participantSnapshot);
    const changedFields = getParticipantChangedFields(current, values);
    if (changedFields.length === 0) return false;

    await synchronizeParticipantLinkedUser(
      transaction,
      projectRef,
      participantId,
      current.linkedUserUid,
      values.linkedUserUid
    );

    transaction.update(participantRef, {
      ...values,
      updatedAt: serverTimestamp(),
      updatedByUid: actor.uid,
    });
    if (personSnapshot.exists()) {
      transaction.update(personRef, personSyncValues(values, actor.uid));
    }
    transaction.set(activityRef, activityPayload(actor, "update", changedFields));
    return true;
  });
}
