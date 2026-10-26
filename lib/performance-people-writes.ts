import {
  doc,
  serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { getPerformanceActivityDefinition, type ActivityActor } from "./activity.ts";
import { removeUndefinedValues } from "./firestore-values.ts";
import {
  getPerformancePersonIds,
  type PerformancePersonDraft,
} from "./performance-people.ts";
import type { CastMember, StaffRole } from "./performance.ts";
import { buildProjectPersonValues } from "./people.ts";
import { buildParticipantValues } from "./participants.ts";
import { runProjectRevisionTransaction } from "./project-revisions.ts";

type PerformancePeopleSection = "cast" | "staff";

export type PerformancePeopleWriteContext = {
  actor: ActivityActor;
  expectedRevision: number;
};

function samePersonFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[]
): boolean {
  return fields.every((field) => Object.is(current[field], next[field]));
}

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

export async function updateProjectPerformancePeopleSection(
  projectId: string,
  section: PerformancePeopleSection,
  value: CastMember[] | StaffRole[],
  peopleDrafts: readonly PerformancePersonDraft[],
  context: PerformancePeopleWriteContext,
  firestore?: Firestore
) {
  const database = await resolveFirestore(firestore);
  const cleanValue = removeUndefinedValues(value) as CastMember[] | StaffRole[];
  const referencedPersonIds = getPerformancePersonIds(section, cleanValue);
  const draftById = new Map<string, PerformancePersonDraft>();
  for (const draft of peopleDrafts) {
    const personId = draft.id.trim();
    if (!personId || personId.includes("/") || personId.length > 128) {
      throw new Error("関係者IDが不正です");
    }
    if (draftById.has(personId)) throw new Error("同じ関係者が重複して指定されています");
    draftById.set(personId, {
      id: personId,
      values: buildProjectPersonValues(draft.values),
    });
  }
  if (referencedPersonIds.some((personId) => !draftById.has(personId))) {
    throw new Error("関連付けた関係者情報を確認できません");
  }

  return runProjectRevisionTransaction({
    firestore: database,
    projectId,
    revisionKey: "performanceInfo",
    expectedRevision: context.expectedRevision,
    updates: {
      [section]: cleanValue,
      performanceInfoUpdatedAt: serverTimestamp(),
    },
    nextValue: cleanValue,
    readCurrentValue: (project) => project[section],
    actor: context.actor,
    activity: getPerformanceActivityDefinition(section),
    prepareAdditionalChanges: async (transaction) => {
      const projectRef = doc(database, "projects", projectId);
      const drafts = referencedPersonIds.map((personId) => draftById.get(personId)!);
      const references = drafts.map(({ id }) => ({
        person: doc(projectRef, "people", id),
        participant: doc(projectRef, "participants", id),
      }));
      const snapshots = await Promise.all(references.flatMap(({ person, participant }) => [
        transaction.get(person),
        transaction.get(participant),
      ]));
      const operations: Array<() => void> = [];
      let personCreated = false;
      let personUpdated = false;

      drafts.forEach((draft, index) => {
        const personSnapshot = snapshots[index * 2];
        const participantSnapshot = snapshots[index * 2 + 1];
        const values = buildProjectPersonValues(draft.values);
        const participantValues = buildParticipantValues({
          displayName: values.displayName,
          specialPractice: values.specialPractice,
          linkedUserUid: values.linkedUserUid,
          publicNote: values.publicNote,
          active: values.active && values.attendanceTarget,
        });
        if (!participantSnapshot.exists() && values.linkedUserUid) {
          throw new Error("システム利用者との紐付けは参加者管理から設定してください");
        }
        if (participantSnapshot.exists()
          && (participantSnapshot.data().linkedUserUid ?? null) !== values.linkedUserUid) {
          throw new Error("システム利用者との紐付けは参加者管理から設定してください");
        }

        const personChanged = !personSnapshot.exists() || !samePersonFields(
          personSnapshot.data(),
          values,
          ["displayName", "attendanceTarget", "specialPractice", "linkedUserUid", "publicNote", "active"]
        );
        const participantChanged = !participantSnapshot.exists() || !samePersonFields(
          participantSnapshot.data(),
          participantValues,
          ["displayName", "specialPractice", "linkedUserUid", "publicNote", "active"]
        );

        if (personChanged) {
          personCreated ||= !personSnapshot.exists();
          personUpdated ||= personSnapshot.exists();
          operations.push(() => {
            if (personSnapshot.exists()) {
              transaction.update(references[index].person, {
                ...values,
                updatedAt: serverTimestamp(),
                updatedByUid: context.actor.uid,
              });
            } else {
              transaction.set(references[index].person, {
                ...values,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdByUid: context.actor.uid,
                updatedByUid: context.actor.uid,
              });
            }
          });
        }
        if (participantChanged) {
          operations.push(() => {
            if (participantSnapshot.exists()) {
              transaction.update(references[index].participant, {
                ...participantValues,
                updatedAt: serverTimestamp(),
                updatedByUid: context.actor.uid,
              });
            } else {
              transaction.set(references[index].participant, {
                ...participantValues,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdByUid: context.actor.uid,
                updatedByUid: context.actor.uid,
              });
            }
          });
        }
      });

      return {
        changedFields: [
          ...(personCreated ? ["関係者を追加"] : []),
          ...(personUpdated ? ["関係者情報"] : []),
        ],
        apply: () => operations.forEach((operation) => operation()),
      };
    },
  });
}
