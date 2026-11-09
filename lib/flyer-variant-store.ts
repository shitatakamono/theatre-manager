import {
  collection, doc, getDocs, runTransaction, serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { getActivityActorName, type ActivityActor } from "./activity.ts";
import { ConflictError, normalizeRevision } from "./project-revisions.ts";
import {
  buildFlyerVariantCopyInput, buildFlyerVariantValues, flyerVariantToInput,
  getFlyerVariantChangedFields, type FlyerVariant, type FlyerVariantInput,
  type FlyerVariantStatus,
} from "./flyer-variants.ts";

type WriteContext = { actor: ActivityActor; expectedRevision: number };

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

function validStatus(value: unknown): value is FlyerVariantStatus {
  return value === "not-started" || value === "in-progress" || value === "review" || value === "complete";
}

function mapFlyerVariant(snapshot: { id: string; data(): Record<string, unknown> }): FlyerVariant {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: typeof data.name === "string" ? data.name : "",
    status: validStatus(data.status) ? data.status : "not-started",
    note: typeof data.note === "string" ? data.note : "",
    revision: normalizeRevision(data.revision),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    updatedByUid: typeof data.updatedByUid === "string" ? data.updatedByUid : "",
  };
}

function timestampMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  return 0;
}

function activityPayload(actor: ActivityActor, action: "create" | "update" | "delete", changedFields: string[]) {
  return {
    actorUid: actor.uid,
    actorName: getActivityActorName(actor),
    action,
    section: "production.flyerVariants",
    sectionLabel: "チラシ・ポスター",
    changedFields,
    createdAt: serverTimestamp(),
  };
}

export async function getProjectFlyerVariants(projectId: string, firestore?: Firestore): Promise<FlyerVariant[]> {
  const database = await resolveFirestore(firestore);
  const snapshot = await getDocs(collection(database, "projects", projectId, "flyerVariants"));
  return snapshot.docs.map(mapFlyerVariant).sort((left, right) =>
    timestampMillis(left.createdAt) - timestampMillis(right.createdAt) || left.id.localeCompare(right.id)
  );
}

export async function createProjectFlyerVariant(
  projectId: string,
  input: FlyerVariantInput,
  actor: ActivityActor,
  firestore?: Firestore
): Promise<string> {
  const values = buildFlyerVariantValues(input);
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const variantRef = doc(collection(projectRef, "flyerVariants"));
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(database, async (transaction) => {
    transaction.set(variantRef, {
      ...values,
      revision: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
    });
    transaction.set(logRef, activityPayload(actor, "create", ["チラシパターンを追加"]));
  });
  return variantRef.id;
}

export async function copyProjectFlyerVariant(
  firestore: Firestore,
  projectId: string,
  sourceId: string,
  actor: ActivityActor
): Promise<string> {
  const projectRef = doc(firestore, "projects", projectId);
  const sourceRef = doc(projectRef, "flyerVariants", sourceId);
  const copyRef = doc(collection(projectRef, "flyerVariants"));
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(sourceRef);
    if (!snapshot.exists()) throw new Error("コピー元のパターンが見つかりません");
    const values = buildFlyerVariantCopyInput(flyerVariantToInput(mapFlyerVariant(snapshot)));
    transaction.set(copyRef, {
      ...values,
      revision: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
    });
    transaction.set(logRef, activityPayload(actor, "create", ["チラシパターンをコピー"]));
  });
  return copyRef.id;
}

export async function updateProjectFlyerVariant(
  firestore: Firestore,
  projectId: string,
  variantId: string,
  input: FlyerVariantInput,
  context: WriteContext
): Promise<{ changed: boolean; revision: number }> {
  const values = buildFlyerVariantValues(input);
  const projectRef = doc(firestore, "projects", projectId);
  const variantRef = doc(projectRef, "flyerVariants", variantId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(variantRef);
    if (!snapshot.exists()) throw new Error("パターンが見つかりません");
    const current = mapFlyerVariant(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    const changedFields = getFlyerVariantChangedFields(flyerVariantToInput(current), values);
    if (changedFields.length === 0) return { changed: false, revision: current.revision };
    const revision = current.revision + 1;
    transaction.update(variantRef, { ...values, revision, updatedAt: serverTimestamp(), updatedByUid: context.actor.uid });
    transaction.set(logRef, activityPayload(context.actor, "update", changedFields));
    return { changed: true, revision };
  });
}

export async function deleteProjectFlyerVariant(
  firestore: Firestore,
  projectId: string,
  variantId: string,
  context: WriteContext
): Promise<void> {
  const projectRef = doc(firestore, "projects", projectId);
  const variantRef = doc(projectRef, "flyerVariants", variantId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(variantRef);
    if (!snapshot.exists()) throw new Error("パターンが見つかりません");
    const current = mapFlyerVariant(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    transaction.delete(variantRef);
    transaction.set(logRef, activityPayload(context.actor, "delete", ["チラシパターンを削除"]));
  });
}
