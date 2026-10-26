import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { getActivityActorName, type ActivityActor } from "./activity.ts";
import type { CastMember, StaffRole } from "./performance.ts";
import {
  buildProjectPersonValues,
  type ProjectPerson,
  type ProjectPersonInput,
  type ProjectPersonValues,
} from "./people.ts";
import {
  buildParticipantValues,
  synchronizeParticipantLinkedUser,
} from "./participants.ts";

export type ManagedPersonInput = Omit<ProjectPersonInput, "active">;

export const EMPTY_MANAGED_PERSON_INPUT: ManagedPersonInput = {
  displayName: "",
  attendanceTarget: false,
  specialPractice: "none",
  linkedUserUid: null,
  publicNote: "",
};

export type PersonAssociations = {
  cast: boolean;
  staff: boolean;
  castLabels: string[];
  staffRoles: string[];
};

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

function participantValues(values: ProjectPersonValues) {
  return buildParticipantValues({
    displayName: values.displayName,
    specialPractice: values.specialPractice,
    linkedUserUid: values.linkedUserUid,
    publicNote: values.publicNote,
    active: values.active && values.attendanceTarget,
  });
}

function sameFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.every((field) => Object.is(current[field], next[field]));
}

export function buildManagedPersonValues(
  input: ManagedPersonInput,
  active = true
): ProjectPersonValues {
  return buildProjectPersonValues({ ...input, active });
}

export function getManagedPersonChangedFields(
  before: ProjectPersonValues,
  after: ProjectPersonValues
): string[] {
  const changed: string[] = [];
  if (before.displayName !== after.displayName) changed.push("本名（管理用）");
  if (before.attendanceTarget !== after.attendanceTarget) changed.push("出欠管理対象");
  if (before.specialPractice !== after.specialPractice) changed.push("特別稽古");
  if (before.linkedUserUid !== after.linkedUserUid) changed.push("システム利用者連携");
  if (before.publicNote !== after.publicNote) changed.push("公開備考");
  return changed;
}

export function filterManagedPeople(
  people: readonly ProjectPerson[],
  includeInactive: boolean
): ProjectPerson[] {
  return people.filter((person) => includeInactive || person.active);
}

export function getPersonAssociations(
  personId: string,
  managementName: string,
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): PersonAssociations {
  const castMembers = cast.filter((member) => member.personId === personId);
  const staffRoles = staff
    .filter((role) => role.members.some((member) => member.personId === personId))
    .map((role) => role.role.trim() || "役職未設定");
  const castCreditNames = [...new Set(castMembers
    .map((member) => member.displayName?.trim())
    .filter((name): name is string => Boolean(name)))];
  return {
    cast: castMembers.length > 0,
    staff: staffRoles.length > 0,
    castLabels: castMembers.length > 0 && castCreditNames.length === 0
      ? [managementName]
      : castCreditNames,
    staffRoles: [...new Set(staffRoles)],
  };
}

function activityPayload(
  actor: ActivityActor,
  action: "create" | "update",
  changedFields: string[]
) {
  return {
    actorUid: actor.uid,
    actorName: getActivityActorName(actor),
    action,
    section: "people",
    sectionLabel: "関係者",
    changedFields,
    createdAt: serverTimestamp(),
  };
}

export async function createProjectPerson(
  projectId: string,
  input: ManagedPersonInput,
  actor: ActivityActor,
  firestore?: Firestore
): Promise<string> {
  const values = buildManagedPersonValues(input, true);
  const compatValues = participantValues(values);
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const personRef = doc(collection(projectRef, "people"));
  const participantRef = doc(projectRef, "participants", personRef.id);
  const activityRef = doc(collection(projectRef, "activityLogs"));

  await runTransaction(database, async (transaction) => {
    const [person, participant] = await Promise.all([
      transaction.get(personRef),
      transaction.get(participantRef),
    ]);
    if (person.exists() || participant.exists()) throw new Error("関係者IDが重複しています");
    await synchronizeParticipantLinkedUser(
      transaction,
      projectRef,
      personRef.id,
      null,
      values.linkedUserUid
    );
    const metadata = {
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
    };
    transaction.set(personRef, { ...values, ...metadata });
    transaction.set(participantRef, { ...compatValues, ...metadata });
    transaction.set(activityRef, activityPayload(actor, "create", [`関係者を追加（${values.displayName}）`]));
  });
  return personRef.id;
}

export async function updateProjectPerson(
  projectId: string,
  personId: string,
  input: ManagedPersonInput,
  actor: ActivityActor,
  firestore?: Firestore
): Promise<boolean> {
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const personRef = doc(projectRef, "people", personId);
  const participantRef = doc(projectRef, "participants", personId);
  const activityRef = doc(collection(projectRef, "activityLogs"));

  return runTransaction(database, async (transaction) => {
    const [personSnapshot, participantSnapshot] = await Promise.all([
      transaction.get(personRef),
      transaction.get(participantRef),
    ]);
    if (!personSnapshot.exists() && !participantSnapshot.exists()) throw new Error("関係者が見つかりません");

    const source = personSnapshot.exists() ? personSnapshot.data() : participantSnapshot.data()!;
    const current = buildProjectPersonValues({
      displayName: typeof source.displayName === "string" ? source.displayName : "",
      attendanceTarget: personSnapshot.exists() ? source.attendanceTarget === true : source.active === true,
      specialPractice: source.specialPractice,
      linkedUserUid: typeof source.linkedUserUid === "string" ? source.linkedUserUid : null,
      publicNote: typeof source.publicNote === "string" ? source.publicNote : "",
      active: personSnapshot.exists() ? source.active === true : source.active !== false,
    });
    const values = buildManagedPersonValues(input, current.active);
    const changedFields = getManagedPersonChangedFields(current, values);
    const compatValues = participantValues(values);
    const compatChanged = !participantSnapshot.exists() || !sameFields(
      participantSnapshot.data(),
      compatValues,
      ["displayName", "specialPractice", "linkedUserUid", "publicNote", "active"]
    );
    if (changedFields.length === 0 && !compatChanged) return false;

    const currentLinkedUserUid = participantSnapshot.exists()
      ? (typeof participantSnapshot.data().linkedUserUid === "string" ? participantSnapshot.data().linkedUserUid : null)
      : null;
    await synchronizeParticipantLinkedUser(
      transaction,
      projectRef,
      personId,
      currentLinkedUserUid,
      values.linkedUserUid
    );

    if (personSnapshot.exists()) {
      transaction.update(personRef, {
        ...values,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
      });
    } else {
      transaction.set(personRef, {
        ...values,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: actor.uid,
        updatedByUid: actor.uid,
      });
    }
    if (participantSnapshot.exists()) {
      transaction.update(participantRef, {
        ...compatValues,
        updatedAt: serverTimestamp(),
        updatedByUid: actor.uid,
      });
    } else {
      transaction.set(participantRef, {
        ...compatValues,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdByUid: actor.uid,
        updatedByUid: actor.uid,
      });
    }
    transaction.set(activityRef, activityPayload(
      actor,
      personSnapshot.exists() ? "update" : "create",
      changedFields.length > 0 ? changedFields : ["互換参加者情報"]
    ));
    return true;
  });
}
