import {
  collection, deleteField, doc, getDocs, runTransaction, serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { getActivityActorName, type ActivityActor } from "./activity.ts";
import {
  buildFlyerDuplicateInput,
  buildFlyerValues,
  flyerToInput,
  getFlyerChangedFields,
  sortFlyers,
  type Flyer,
  type FlyerInput,
  type FlyerSides,
} from "./flyers.ts";
import { ConflictError, normalizeRevision } from "./project-revisions.ts";

type WriteContext = { actor: ActivityActor; expectedRevision: number };

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

function validSides(value: unknown): value is FlyerSides {
  return value === "" || value === "single" || value === "double";
}

function optionalString(data: Record<string, unknown>, key: string): string | undefined {
  return typeof data[key] === "string" && data[key] ? data[key] : undefined;
}

function optionalNumber(data: Record<string, unknown>, key: string): number | undefined {
  return typeof data[key] === "number" ? data[key] : undefined;
}

function mapFlyer(snapshot: { id: string; data(): Record<string, unknown> }): Flyer {
  const data = snapshot.data();
  const sides = validSides(data.sides) ? data.sides : undefined;
  return {
    id: snapshot.id,
    name: typeof data.name === "string" ? data.name : "",
    enabled: data.enabled === true,
    ...(optionalString(data, "size") ? { size: optionalString(data, "size") } : {}),
    ...(sides ? { sides } : {}),
    ...(optionalNumber(data, "quantity") !== undefined ? { quantity: optionalNumber(data, "quantity") } : {}),
    ...(optionalString(data, "printer") ? { printer: optionalString(data, "printer") } : {}),
    ...(optionalString(data, "submissionPlannedDate") ? { submissionPlannedDate: optionalString(data, "submissionPlannedDate") } : {}),
    ...(optionalString(data, "submissionDate") ? { submissionDate: optionalString(data, "submissionDate") } : {}),
    ...(optionalString(data, "deliveryPlannedDate") ? { deliveryPlannedDate: optionalString(data, "deliveryPlannedDate") } : {}),
    ...(optionalString(data, "deliveryDate") ? { deliveryDate: optionalString(data, "deliveryDate") } : {}),
    ...(optionalNumber(data, "printCost") !== undefined ? { printCost: optionalNumber(data, "printCost") } : {}),
    ...(optionalNumber(data, "order") !== undefined ? { order: optionalNumber(data, "order") } : {}),
    revision: normalizeRevision(data.revision),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    updatedByUid: typeof data.updatedByUid === "string" ? data.updatedByUid : "",
  };
}

function activityPayload(actor: ActivityActor, action: "create" | "update" | "delete", changedFields: string[]) {
  return {
    actorUid: actor.uid,
    actorName: getActivityActorName(actor),
    action,
    section: "production.flyers",
    sectionLabel: "チラシ・ポスター",
    changedFields,
    createdAt: serverTimestamp(),
  };
}

function updateValues(values: FlyerInput) {
  return {
    name: values.name,
    enabled: values.enabled,
    size: values.size ?? deleteField(),
    sides: values.sides ?? deleteField(),
    quantity: values.quantity ?? deleteField(),
    printer: values.printer ?? deleteField(),
    submissionPlannedDate: values.submissionPlannedDate ?? deleteField(),
    submissionDate: values.submissionDate ?? deleteField(),
    deliveryPlannedDate: values.deliveryPlannedDate ?? deleteField(),
    deliveryDate: values.deliveryDate ?? deleteField(),
    printCost: values.printCost ?? deleteField(),
    order: values.order ?? deleteField(),
  };
}

async function createWithActivity(
  projectId: string,
  input: FlyerInput,
  actor: ActivityActor,
  changedField: "チラシ追加" | "チラシ複製",
  firestore?: Firestore
): Promise<string> {
  const values = buildFlyerValues(input);
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const flyerRef = doc(collection(projectRef, "flyers"));
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(database, async (transaction) => {
    transaction.set(flyerRef, {
      ...values,
      revision: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
    });
    transaction.set(logRef, activityPayload(actor, "create", [changedField]));
  });
  return flyerRef.id;
}

export async function getProjectFlyers(projectId: string, firestore?: Firestore): Promise<Flyer[]> {
  const database = await resolveFirestore(firestore);
  const snapshot = await getDocs(collection(database, "projects", projectId, "flyers"));
  return sortFlyers(snapshot.docs.map(mapFlyer));
}

export function createProjectFlyer(projectId: string, input: FlyerInput, actor: ActivityActor, firestore?: Firestore) {
  return createWithActivity(projectId, input, actor, "チラシ追加", firestore);
}

export function copyLegacyProjectFlyer(projectId: string, input: FlyerInput, actor: ActivityActor, firestore?: Firestore) {
  return createWithActivity(projectId, buildFlyerDuplicateInput(input), actor, "チラシ複製", firestore);
}

export async function copyProjectFlyer(
  firestore: Firestore,
  projectId: string,
  sourceId: string,
  actor: ActivityActor
): Promise<string> {
  const projectRef = doc(firestore, "projects", projectId);
  const sourceRef = doc(projectRef, "flyers", sourceId);
  const copyRef = doc(collection(projectRef, "flyers"));
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(sourceRef);
    if (!snapshot.exists()) throw new Error("コピー元のチラシが見つかりません");
    const values = buildFlyerDuplicateInput(flyerToInput(mapFlyer(snapshot)));
    transaction.set(copyRef, {
      ...values,
      revision: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
    });
    transaction.set(logRef, activityPayload(actor, "create", ["チラシ複製"]));
  });
  return copyRef.id;
}

export async function updateProjectFlyer(
  firestore: Firestore,
  projectId: string,
  flyerId: string,
  input: FlyerInput,
  context: WriteContext
): Promise<{ changed: boolean; revision: number }> {
  const values = buildFlyerValues(input);
  const projectRef = doc(firestore, "projects", projectId);
  const flyerRef = doc(projectRef, "flyers", flyerId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(flyerRef);
    if (!snapshot.exists()) throw new Error("チラシが見つかりません");
    const current = mapFlyer(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    const changedFields = getFlyerChangedFields(flyerToInput(current), values);
    if (changedFields.length === 0) return { changed: false, revision: current.revision };
    const revision = current.revision + 1;
    transaction.update(flyerRef, {
      ...updateValues(values),
      revision,
      updatedAt: serverTimestamp(),
      updatedByUid: context.actor.uid,
    });
    transaction.set(logRef, activityPayload(context.actor, "update", ["チラシ更新", ...changedFields]));
    return { changed: true, revision };
  });
}

export async function deleteProjectFlyer(
  firestore: Firestore,
  projectId: string,
  flyerId: string,
  context: WriteContext
): Promise<void> {
  const projectRef = doc(firestore, "projects", projectId);
  const flyerRef = doc(projectRef, "flyers", flyerId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(flyerRef);
    if (!snapshot.exists()) throw new Error("チラシが見つかりません");
    const current = mapFlyer(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    transaction.delete(flyerRef);
    transaction.set(logRef, activityPayload(context.actor, "delete", ["チラシ削除"]));
  });
}
