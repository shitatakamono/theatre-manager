import { collection, doc, getDocs, runTransaction, serverTimestamp, type Firestore } from "firebase/firestore";
import { getActivityActorName, type ActivityActor } from "./activity.ts";
import { ConflictError, normalizeRevision } from "./project-revisions.ts";
import {
  buildProductionAssetValues, getProductionAssetChangedFields, productionAssetToInput,
  type ProductionAsset, type ProductionAssetInput, type ProductionAssetType,
} from "./production-assets.ts";

type WriteContext = { actor: ActivityActor; expectedRevision: number };

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

function validType(value: unknown): value is ProductionAssetType {
  return ["troupe_logo", "performance_logo", "flyer", "photo", "venue", "other"].includes(String(value));
}

function mapAsset(snapshot: { id: string; data(): Record<string, unknown> }): ProductionAsset {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: typeof data.name === "string" ? data.name : "",
    type: validType(data.type) ? data.type : "other",
    url: typeof data.url === "string" ? data.url : "",
    note: typeof data.note === "string" ? data.note : "",
    revision: normalizeRevision(data.revision),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    updatedByUid: typeof data.updatedByUid === "string" ? data.updatedByUid : "",
  };
}

function millis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function activity(actor: ActivityActor, action: "create" | "update" | "delete", changedFields: string[]) {
  return {
    actorUid: actor.uid, actorName: getActivityActorName(actor), action,
    section: "production.assets", sectionLabel: "制作素材", changedFields,
    createdAt: serverTimestamp(),
  };
}

export async function getProjectProductionAssets(projectId: string, firestore?: Firestore): Promise<ProductionAsset[]> {
  const database = await resolveFirestore(firestore);
  const snapshot = await getDocs(collection(database, "projects", projectId, "assets"));
  return snapshot.docs.map(mapAsset).sort((left, right) =>
    millis(right.updatedAt) - millis(left.updatedAt) || left.name.localeCompare(right.name, "ja") || left.id.localeCompare(right.id)
  );
}

export async function createProjectProductionAsset(projectId: string, input: ProductionAssetInput, actor: ActivityActor, firestore?: Firestore): Promise<string> {
  const values = buildProductionAssetValues(input);
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const assetRef = doc(collection(projectRef, "assets"));
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(database, async (transaction) => {
    transaction.set(assetRef, { ...values, revision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdByUid: actor.uid, updatedByUid: actor.uid });
    transaction.set(logRef, activity(actor, "create", ["素材情報を追加"]));
  });
  return assetRef.id;
}

export async function updateProjectProductionAsset(firestore: Firestore, projectId: string, assetId: string, input: ProductionAssetInput, context: WriteContext) {
  const values = buildProductionAssetValues(input);
  const projectRef = doc(firestore, "projects", projectId);
  const assetRef = doc(projectRef, "assets", assetId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(assetRef);
    if (!snapshot.exists()) throw new Error("素材情報が見つかりません");
    const current = mapAsset(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    const changedFields = getProductionAssetChangedFields(productionAssetToInput(current), values);
    if (changedFields.length === 0) return { changed: false, revision: current.revision };
    const revision = current.revision + 1;
    transaction.update(assetRef, { ...values, revision, updatedAt: serverTimestamp(), updatedByUid: context.actor.uid });
    transaction.set(logRef, activity(context.actor, "update", changedFields));
    return { changed: true, revision };
  });
}

export async function deleteProjectProductionAsset(firestore: Firestore, projectId: string, assetId: string, context: WriteContext): Promise<void> {
  const projectRef = doc(firestore, "projects", projectId);
  const assetRef = doc(projectRef, "assets", assetId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(assetRef);
    if (!snapshot.exists()) throw new Error("素材情報が見つかりません");
    const current = mapAsset(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    transaction.delete(assetRef);
    transaction.set(logRef, activity(context.actor, "delete", ["素材情報を削除"]));
  });
}
