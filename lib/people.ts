import {
  collection,
  doc,
  getDocs,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import {
  buildParticipantValues,
  getProjectParticipants,
  type Participant,
  type SpecialPractice,
} from "./participants.ts";
import {
  normalizeRehearsalParticipationTypes,
  type RehearsalParticipationType,
} from "./rehearsal-participation.ts";

export type ProjectPersonInput = {
  displayName: string;
  attendanceTarget: boolean;
  specialPractice: SpecialPractice;
  rehearsalParticipationTypes?: readonly RehearsalParticipationType[];
  linkedUserUid: string | null;
  publicNote: string;
  active: boolean;
};

export type ProjectPersonValues = Omit<ProjectPersonInput, "rehearsalParticipationTypes"> & {
  rehearsalParticipationTypes: RehearsalParticipationType[];
};

export type ProjectPerson = ProjectPersonValues & {
  id: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid: string;
  updatedByUid: string;
};

export type PeopleMigrationResult = {
  dryRun: boolean;
  participantCount: number;
  createdPersonIds: string[];
  skippedPersonIds: string[];
};

const MIGRATION_TRANSACTION_SIZE = 10;

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

export function buildProjectPersonValues(input: ProjectPersonInput): ProjectPersonValues {
  if (typeof input.attendanceTarget !== "boolean") throw new Error("出欠管理対象の指定が不正です");
  const participantValues = buildParticipantValues({
    displayName: input.displayName,
    specialPractice: input.specialPractice,
    rehearsalParticipationTypes: input.rehearsalParticipationTypes,
    linkedUserUid: input.linkedUserUid,
    publicNote: input.publicNote,
    active: input.active,
  });
  return { ...participantValues, attendanceTarget: input.attendanceTarget };
}

export function participantToProjectPerson(participant: Participant): ProjectPerson {
  return {
    id: participant.id,
    displayName: participant.displayName,
    attendanceTarget: participant.active,
    specialPractice: participant.specialPractice,
    rehearsalParticipationTypes: normalizeRehearsalParticipationTypes(
      participant.rehearsalParticipationTypes,
      participant.specialPractice
    ),
    linkedUserUid: participant.linkedUserUid,
    publicNote: participant.publicNote,
    active: participant.active,
    createdAt: participant.createdAt,
    updatedAt: participant.updatedAt,
    createdByUid: participant.createdByUid,
    updatedByUid: participant.updatedByUid,
  };
}

export function personToParticipantCompat(person: ProjectPerson): Participant {
  return {
    id: person.id,
    displayName: person.displayName,
    specialPractice: person.specialPractice,
    rehearsalParticipationTypes: normalizeRehearsalParticipationTypes(
      person.rehearsalParticipationTypes,
      person.specialPractice
    ),
    linkedUserUid: person.linkedUserUid,
    publicNote: person.publicNote,
    active: person.active && person.attendanceTarget,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
    createdByUid: person.createdByUid,
    updatedByUid: person.updatedByUid,
  };
}

function mapProjectPerson(snapshot: QueryDocumentSnapshot): ProjectPerson {
  const data = snapshot.data();
  const values = buildProjectPersonValues({
    displayName: typeof data.displayName === "string" ? data.displayName : "",
    attendanceTarget: data.attendanceTarget === true,
    specialPractice: data.specialPractice,
    rehearsalParticipationTypes: normalizeRehearsalParticipationTypes(
      data.rehearsalParticipationTypes,
      data.specialPractice
    ),
    linkedUserUid: typeof data.linkedUserUid === "string" ? data.linkedUserUid : null,
    publicNote: typeof data.publicNote === "string" ? data.publicNote : "",
    active: data.active === true,
  });
  return {
    id: snapshot.id,
    ...values,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    updatedByUid: typeof data.updatedByUid === "string" ? data.updatedByUid : "",
  };
}

export function mergePeopleWithParticipantFallback(
  people: readonly ProjectPerson[],
  participants: readonly Participant[]
): ProjectPerson[] {
  const merged = new Map(participants.map((participant) => [
    participant.id,
    participantToProjectPerson(participant),
  ]));
  people.forEach((person) => merged.set(person.id, person));
  return [...merged.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName, "ja") || left.id.localeCompare(right.id)
  );
}

export async function getProjectPeople(
  projectId: string,
  firestore?: Firestore
): Promise<ProjectPerson[]> {
  const database = await resolveFirestore(firestore);
  const snapshot = await getDocs(collection(database, "projects", projectId, "people"));
  return snapshot.docs
    .map(mapProjectPerson)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja") || left.id.localeCompare(right.id));
}

export async function getProjectPeopleWithFallback(
  projectId: string,
  firestore?: Firestore
): Promise<ProjectPerson[]> {
  const database = await resolveFirestore(firestore);
  const [people, participants] = await Promise.all([
    getProjectPeople(projectId, database),
    getProjectParticipants(projectId, database),
  ]);
  return mergePeopleWithParticipantFallback(people, participants);
}

export async function getProjectAttendanceParticipants(
  projectId: string,
  firestore?: Firestore
): Promise<Participant[]> {
  return (await getProjectPeopleWithFallback(projectId, firestore)).map(personToParticipantCompat);
}

export function buildPersonMigrationDocument(
  participant: Participant,
  actorUid: string,
  fallbackTimestamp: unknown
) {
  const person = participantToProjectPerson(participant);
  return {
    displayName: person.displayName,
    attendanceTarget: person.attendanceTarget,
    specialPractice: person.specialPractice,
    rehearsalParticipationTypes: person.rehearsalParticipationTypes,
    linkedUserUid: person.linkedUserUid,
    publicNote: person.publicNote,
    active: person.active,
    createdAt: person.createdAt ?? fallbackTimestamp,
    updatedAt: person.updatedAt ?? fallbackTimestamp,
    createdByUid: person.createdByUid || actorUid,
    updatedByUid: person.updatedByUid || actorUid,
  };
}

export async function migrateProjectParticipantsToPeople(
  projectId: string,
  actorUid: string,
  options: { dryRun?: boolean; firestore?: Firestore } = {}
): Promise<PeopleMigrationResult> {
  const normalizedActorUid = actorUid.trim();
  if (!normalizedActorUid) throw new Error("移行実行者情報が不正です");
  const database = await resolveFirestore(options.firestore);
  const [participants, existingPeople] = await Promise.all([
    getProjectParticipants(projectId, database),
    getProjectPeople(projectId, database),
  ]);
  const existingIds = new Set(existingPeople.map(({ id }) => id));
  const candidates = participants.filter(({ id }) => !existingIds.has(id));
  const skippedPersonIds = participants.filter(({ id }) => existingIds.has(id)).map(({ id }) => id);

  if (options.dryRun) {
    return {
      dryRun: true,
      participantCount: participants.length,
      createdPersonIds: candidates.map(({ id }) => id),
      skippedPersonIds,
    };
  }

  const createdPersonIds: string[] = [];
  for (let offset = 0; offset < candidates.length; offset += MIGRATION_TRANSACTION_SIZE) {
    const chunk = candidates.slice(offset, offset + MIGRATION_TRANSACTION_SIZE);
    const created = await runTransaction(database, async (transaction) => {
      const references = chunk.map(({ id }) => doc(database, "projects", projectId, "people", id));
      const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
      const ids: string[] = [];
      snapshots.forEach((snapshot, index) => {
        if (snapshot.exists()) return;
        transaction.set(references[index], buildPersonMigrationDocument(
          chunk[index],
          normalizedActorUid,
          serverTimestamp()
        ));
        ids.push(chunk[index].id);
      });
      return ids;
    });
    createdPersonIds.push(...created);
  }

  return {
    dryRun: false,
    participantCount: participants.length,
    createdPersonIds,
    skippedPersonIds: participants
      .map(({ id }) => id)
      .filter((id) => !createdPersonIds.includes(id)),
  };
}
