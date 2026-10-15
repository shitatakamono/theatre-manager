import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
  type Firestore,
} from "firebase/firestore";
import {
  getActivityActorName,
  getChangedFields,
  type ActivityActor,
  type ActivityDefinition,
} from "./activity.ts";

export const REVISION_KEYS = [
  "performanceInfo",
  "venue",
  "flyer",
  "web",
  "ticket",
  "reception",
  "accounting",
] as const;

export type RevisionKey = (typeof REVISION_KEYS)[number];
export type ProjectRevisions = Partial<Record<RevisionKey, number>>;

export const CONFLICT_MESSAGE =
  "他のメンバーが、この画面を先に更新しました。あなたの変更はまだ保存されていません。最新の内容を確認してから、もう一度編集してください。";

export class ConflictError extends Error {
  readonly code = "section-conflict";
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(
    expectedRevision: number,
    actualRevision: number
  ) {
    super(CONFLICT_MESSAGE);
    this.name = "ConflictError";
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export function isConflictError(error: unknown): error is ConflictError {
  return error instanceof ConflictError || (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === "section-conflict"
  );
}

export function normalizeRevision(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : 0;
}

export function getProjectRevision(
  revisions: ProjectRevisions | undefined,
  key: RevisionKey
): number {
  return normalizeRevision(revisions?.[key]);
}

export type RevisionTransactionInput = {
  firestore: Firestore;
  projectId: string;
  revisionKey: RevisionKey;
  expectedRevision: number;
  updates: Record<string, unknown>;
  nextValue: unknown;
  readCurrentValue: (project: DocumentData) => unknown;
  actor: ActivityActor;
  activity: ActivityDefinition;
};

export type RevisionTransactionResult = {
  changed: boolean;
  revision: number;
  changedFields: string[];
};

export async function runProjectRevisionTransaction({
  firestore,
  projectId,
  revisionKey,
  expectedRevision,
  updates,
  nextValue,
  readCurrentValue,
  actor,
  activity,
}: RevisionTransactionInput): Promise<RevisionTransactionResult> {
  const projectRef = doc(firestore, "projects", projectId);
  const activityRef = doc(collection(projectRef, "activityLogs"));

  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(projectRef);
    if (!snapshot.exists()) throw new Error("公演が見つかりません");

    const project = snapshot.data();
    const revision = getProjectRevision(
      project.revisions as ProjectRevisions | undefined,
      revisionKey
    );

    if (revision !== expectedRevision) {
      throw new ConflictError(expectedRevision, revision);
    }

    const changedFields = getChangedFields(
      readCurrentValue(project),
      nextValue,
      activity.fields
    );
    if (changedFields.length === 0) {
      return { changed: false, revision, changedFields };
    }

    const nextRevision = revision + 1;
    transaction.update(projectRef, {
      ...updates,
      [`revisions.${revisionKey}`]: nextRevision,
    });
    transaction.set(activityRef, {
      actorUid: actor.uid,
      actorName: getActivityActorName(actor),
      action: "update",
      section: activity.section,
      sectionLabel: activity.sectionLabel,
      changedFields,
      createdAt: serverTimestamp(),
    });

    return { changed: true, revision: nextRevision, changedFields };
  });
}
