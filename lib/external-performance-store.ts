import {
  collection, doc, getDocs, runTransaction, serverTimestamp,
  type Firestore,
} from "firebase/firestore";
import { getActivityActorName, type ActivityActor } from "./activity.ts";
import { ConflictError, normalizeRevision } from "./project-revisions.ts";
import {
  buildExternalPerformanceValues, getExternalPerformanceChangedFields, sortExternalPerformances,
  type ExternalPerformance, type ExternalPerformanceInput, type ExternalPerformanceValues,
} from "./external-performances.ts";

type WriteContext = { actor: ActivityActor; expectedRevision: number };

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

function mapExternalPerformance(snapshot: { id: string; data(): Record<string, unknown> }): ExternalPerformance {
  const data = snapshot.data();
  const insertion = data.insertion && typeof data.insertion === "object"
    ? data.insertion as ExternalPerformanceValues["insertion"] : null;
  return {
    id: snapshot.id,
    organizationName: typeof data.organizationName === "string" ? data.organizationName : "",
    performanceName: typeof data.performanceName === "string" ? data.performanceName : "",
    startDate: typeof data.startDate === "string" ? data.startDate : "",
    endDate: typeof data.endDate === "string" ? data.endDate : "",
    venue: typeof data.venue === "string" ? data.venue : "",
    contact: typeof data.contact === "string" ? data.contact : "",
    contactMethod: typeof data.contactMethod === "string" ? data.contactMethod : "",
    contactPerson: typeof data.contactPerson === "string" ? data.contactPerson : "",
    note: typeof data.note === "string" ? data.note : "",
    insertion,
    revision: normalizeRevision(data.revision), createdAt: data.createdAt, updatedAt: data.updatedAt,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    updatedByUid: typeof data.updatedByUid === "string" ? data.updatedByUid : "",
  };
}

function activityPayload(actor: ActivityActor, action: "create" | "update" | "delete", changedFields: string[]) {
  return {
    actorUid: actor.uid, actorName: getActivityActorName(actor), action,
    section: "externalPerformances", sectionLabel: "他団体公演・折込", changedFields,
    createdAt: serverTimestamp(),
  };
}

export async function getProjectExternalPerformances(projectId: string, firestore?: Firestore): Promise<ExternalPerformance[]> {
  const database = await resolveFirestore(firestore);
  const snapshot = await getDocs(collection(database, "projects", projectId, "externalPerformances"));
  return sortExternalPerformances(snapshot.docs.map(mapExternalPerformance));
}

export async function createProjectExternalPerformance(
  projectId: string, input: ExternalPerformanceInput, actor: ActivityActor, firestore?: Firestore
): Promise<string> {
  const values = buildExternalPerformanceValues(input);
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const recordRef = doc(collection(projectRef, "externalPerformances"));
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(database, async (transaction) => {
    transaction.set(recordRef, { ...values, revision: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdByUid: actor.uid, updatedByUid: actor.uid });
    transaction.set(logRef, activityPayload(actor, "create", ["他団体公演を追加"]));
  });
  return recordRef.id;
}

export async function updateProjectExternalPerformance(
  firestore: Firestore, projectId: string, recordId: string, input: ExternalPerformanceInput, context: WriteContext
): Promise<{ changed: boolean; revision: number }> {
  const values = buildExternalPerformanceValues(input);
  const projectRef = doc(firestore, "projects", projectId);
  const recordRef = doc(projectRef, "externalPerformances", recordId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists()) throw new Error("公演情報が見つかりません");
    const current = mapExternalPerformance(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    const changedFields = getExternalPerformanceChangedFields(current, values);
    if (changedFields.length === 0) return { changed: false, revision: current.revision };
    const revision = current.revision + 1;
    transaction.update(recordRef, { ...values, revision, updatedAt: serverTimestamp(), updatedByUid: context.actor.uid });
    transaction.set(logRef, activityPayload(context.actor, "update", changedFields));
    return { changed: true, revision };
  });
}

export async function deleteProjectExternalPerformance(
  firestore: Firestore, projectId: string, recordId: string, context: WriteContext
): Promise<void> {
  const projectRef = doc(firestore, "projects", projectId);
  const recordRef = doc(projectRef, "externalPerformances", recordId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(recordRef);
    if (!snapshot.exists()) throw new Error("公演情報が見つかりません");
    const current = mapExternalPerformance(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    transaction.delete(recordRef);
    transaction.set(logRef, activityPayload(context.actor, "delete", ["他団体公演を削除"]));
  });
}
