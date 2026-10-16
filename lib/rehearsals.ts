import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
} from "firebase/firestore";
import { getActivityActorName, type ActivityActor } from "./activity.ts";
import { ConflictError, normalizeRevision } from "./project-revisions.ts";

export const REHEARSAL_TYPE_OPTIONS = [
  { value: "acting", label: "芝居" },
  { value: "stage_combat", label: "殺陣" },
  { value: "japanese_dance", label: "日舞" },
  { value: "meeting", label: "打ち合わせ" },
  { value: "other", label: "その他" },
] as const;

export type RehearsalType = (typeof REHEARSAL_TYPE_OPTIONS)[number]["value"];

export const REHEARSAL_TYPES = REHEARSAL_TYPE_OPTIONS.map(({ value }) => value);
export const REHEARSAL_TYPE_LABELS = Object.fromEntries(
  REHEARSAL_TYPE_OPTIONS.map(({ value, label }) => [value, label])
) as Record<RehearsalType, string>;

export type RehearsalInput = {
  date: string;
  startTime: string;
  endTime: string;
  type: RehearsalType;
  customType: string;
  venue: string;
  content: string;
  note: string;
};

export type RehearsalValues = {
  startAt: Timestamp;
  endAt: Timestamp | null;
  type: RehearsalType;
  customType: string;
  venue: string;
  content: string;
  note: string;
};

export type Rehearsal = RehearsalValues & {
  id: string;
  revision: number;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid: string;
  updatedByUid: string;
};

export type RehearsalWriteContext = {
  actor: ActivityActor;
  expectedRevision: number;
};

export type RehearsalWriteResult = {
  changed: boolean;
  revision: number;
  changedFields: string[];
};

export const EMPTY_REHEARSAL_INPUT: RehearsalInput = {
  date: "",
  startTime: "",
  endTime: "",
  type: "acting",
  customType: "",
  venue: "",
  content: "",
  note: "",
};

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

const TOKYO_OFFSET = "+09:00";

function validDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validTimeString(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function toTokyoTimestamp(date: string, time: string): Timestamp {
  if (!validDateString(date) || !validTimeString(time)) {
    throw new Error("日付と開始時刻を正しく入力してください");
  }
  const parsed = new Date(`${date}T${time}:00${TOKYO_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) throw new Error("日時を正しく入力してください");
  return Timestamp.fromDate(parsed);
}

export function timestampToTokyoInput(value: Timestamp): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value.toDate());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

export function buildRehearsalValues(input: RehearsalInput): RehearsalValues {
  const type = input.type;
  if (!REHEARSAL_TYPES.includes(type)) throw new Error("稽古種別が不正です");
  const customType = input.customType.trim();
  if (type === "other" && !customType) throw new Error("「その他」の種別名を入力してください");
  if (type !== "other" && customType) throw new Error("種別名は「その他」の場合のみ入力できます");

  const startAt = toTokyoTimestamp(input.date, input.startTime);
  const endAt = input.endTime ? toTokyoTimestamp(input.date, input.endTime) : null;
  if (endAt && endAt.toMillis() <= startAt.toMillis()) {
    throw new Error("終了時刻は開始時刻より後にしてください");
  }

  const venue = input.venue.trim();
  const content = input.content.trim();
  const note = input.note.trim();
  if (customType.length > 100 || venue.length > 200 || content.length > 2000 || note.length > 5000) {
    throw new Error("入力できる文字数を超えています");
  }
  return { startAt, endAt, type, customType, venue, content, note };
}

export function rehearsalToInput(rehearsal: Rehearsal): RehearsalInput {
  const start = timestampToTokyoInput(rehearsal.startAt);
  const end = rehearsal.endAt ? timestampToTokyoInput(rehearsal.endAt).time : "";
  return {
    date: start.date,
    startTime: start.time,
    endTime: end,
    type: rehearsal.type,
    customType: rehearsal.customType,
    venue: rehearsal.venue,
    content: rehearsal.content,
    note: rehearsal.note,
  };
}

function sameTimestamp(left: Timestamp | null, right: Timestamp | null): boolean {
  return left === right || (left !== null && right !== null && left.toMillis() === right.toMillis());
}

export function getRehearsalChangedFields(before: RehearsalValues, after: RehearsalValues): string[] {
  const changed: string[] = [];
  if (!sameTimestamp(before.startAt, after.startAt) || !sameTimestamp(before.endAt, after.endAt)) changed.push("日時");
  if (before.type !== after.type || before.customType !== after.customType) changed.push("稽古種別");
  if (before.venue !== after.venue) changed.push("場所");
  if (before.content !== after.content) changed.push("内容");
  if (before.note !== after.note) changed.push("備考");
  return changed;
}

export function getRehearsalTypeLabel(type: RehearsalType, customType: string): string {
  return type === "other" ? customType || REHEARSAL_TYPE_LABELS.other : REHEARSAL_TYPE_LABELS[type];
}

export function normalizeStoredRehearsalType(value: unknown): RehearsalType {
  if (typeof value === "string" && REHEARSAL_TYPES.includes(value as RehearsalType)) {
    return value as RehearsalType;
  }
  // v1手動検証中に保存された旧固定種別は、読込時だけ芝居として扱う。
  if (value === "reading" || value === "run_through") return "acting";
  return "other";
}

export function getNextRehearsals(rehearsals: Rehearsal[]): Rehearsal[] {
  if (rehearsals.length === 0) return [];
  const firstStart = Math.min(...rehearsals.map((item) => item.startAt.toMillis()));
  return rehearsals.filter((item) => item.startAt.toMillis() === firstStart);
}

export function formatRehearsalActivityDate(startAt: Timestamp): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(startAt.toDate());
}

function activityPayload(actor: ActivityActor, action: "create" | "update" | "delete", changedFields: string[]) {
  return {
    actorUid: actor.uid,
    actorName: getActivityActorName(actor),
    action,
    section: "rehearsals",
    sectionLabel: "稽古",
    changedFields,
    createdAt: serverTimestamp(),
  };
}

function mapRehearsal(snapshot: { id: string; data(): Record<string, unknown> }): Rehearsal {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    startAt: data.startAt as Timestamp,
    endAt: (data.endAt as Timestamp | null) ?? null,
    type: normalizeStoredRehearsalType(data.type),
    customType: data.type === "other" ? ((data.customType as string) ?? "") : "",
    venue: (data.venue as string) ?? "",
    content: (data.content as string) ?? "",
    note: (data.note as string) ?? "",
    revision: normalizeRevision(data.revision),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdByUid: data.createdByUid as string,
    updatedByUid: data.updatedByUid as string,
  };
}

export async function getProjectRehearsals(projectId: string, now = Timestamp.now(), firestore?: Firestore): Promise<{ upcoming: Rehearsal[]; past: Rehearsal[] }> {
  const database = await resolveFirestore(firestore);
  const ref = collection(database, "projects", projectId, "rehearsals");
  const [upcomingSnapshot, pastSnapshot] = await Promise.all([
    getDocs(query(ref, where("startAt", ">=", now), orderBy("startAt", "asc"), limit(100))),
    getDocs(query(ref, where("startAt", "<", now), orderBy("startAt", "desc"), limit(100))),
  ]);
  return {
    upcoming: upcomingSnapshot.docs.map(mapRehearsal),
    past: pastSnapshot.docs.map(mapRehearsal),
  };
}

export async function getProjectRehearsal(projectId: string, rehearsalId: string, firestore?: Firestore): Promise<Rehearsal | null> {
  const database = await resolveFirestore(firestore);
  const snapshot = await getDoc(doc(database, "projects", projectId, "rehearsals", rehearsalId));
  return snapshot.exists() ? mapRehearsal(snapshot) : null;
}

export async function createProjectRehearsal(projectId: string, input: RehearsalInput, actor: ActivityActor, firestore?: Firestore): Promise<string> {
  const values = buildRehearsalValues(input);
  const ids = await createProjectRehearsalBatch(
    projectId,
    [input],
    actor,
    `稽古予定を追加（${formatRehearsalActivityDate(values.startAt)}）`,
    firestore
  );
  return ids[0];
}

export async function createProjectRehearsalBatch(
  projectId: string,
  inputs: RehearsalInput[],
  actor: ActivityActor,
  activityMessage: string,
  firestore?: Firestore
): Promise<string[]> {
  if (inputs.length === 0) throw new Error("稽古予定を1件以上選択してください");
  if (inputs.length > 100) throw new Error("一度に追加できる稽古は100件までです");
  const values = inputs.map(buildRehearsalValues);
  const database = await resolveFirestore(firestore);
  const projectRef = doc(database, "projects", projectId);
  const rehearsalRefs = values.map(() => doc(collection(projectRef, "rehearsals")));
  const batch = writeBatch(database);
  values.forEach((value, index) => {
    batch.set(rehearsalRefs[index], {
      ...value,
      revision: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdByUid: actor.uid,
      updatedByUid: actor.uid,
    });
  });
  batch.set(doc(collection(projectRef, "activityLogs")), activityPayload(actor, "create", [activityMessage]));
  await batch.commit();
  return rehearsalRefs.map((reference) => reference.id);
}

export async function createProjectRehearsals(projectId: string, dates: string[], shared: Omit<RehearsalInput, "date">, actor: ActivityActor, firestore?: Firestore): Promise<number> {
  const uniqueDates = [...new Set(dates.map((date) => date.trim()).filter(Boolean))];
  if (uniqueDates.length === 0) throw new Error("日付を1件以上入力してください");
  if (uniqueDates.length > 100) throw new Error("一度に追加できる稽古は100件までです");
  const inputs = uniqueDates.map((date) => ({ ...shared, date }));
  await createProjectRehearsalBatch(
    projectId,
    inputs,
    actor,
    `稽古予定を${inputs.length}件追加`,
    firestore
  );
  return inputs.length;
}

export async function updateProjectRehearsal(
  firestore: Firestore,
  projectId: string,
  rehearsalId: string,
  input: RehearsalInput,
  context: RehearsalWriteContext
): Promise<RehearsalWriteResult> {
  const values = buildRehearsalValues(input);
  const projectRef = doc(firestore, "projects", projectId);
  const rehearsalRef = doc(projectRef, "rehearsals", rehearsalId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  return runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(rehearsalRef);
    if (!snapshot.exists()) throw new Error("稽古予定が見つかりません");
    const current = mapRehearsal(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    const changedFields = getRehearsalChangedFields(current, values);
    if (changedFields.length === 0) return { changed: false, revision: current.revision, changedFields };
    const revision = current.revision + 1;
    transaction.update(rehearsalRef, { ...values, revision, updatedAt: serverTimestamp(), updatedByUid: context.actor.uid });
    transaction.set(logRef, activityPayload(context.actor, "update", changedFields));
    return { changed: true, revision, changedFields };
  });
}

export async function deleteProjectRehearsal(
  firestore: Firestore,
  projectId: string,
  rehearsalId: string,
  context: RehearsalWriteContext
): Promise<void> {
  const projectRef = doc(firestore, "projects", projectId);
  const rehearsalRef = doc(projectRef, "rehearsals", rehearsalId);
  const logRef = doc(collection(projectRef, "activityLogs"));
  await runTransaction(firestore, async (transaction) => {
    const snapshot = await transaction.get(rehearsalRef);
    if (!snapshot.exists()) throw new Error("稽古予定が見つかりません");
    const current = mapRehearsal(snapshot);
    if (current.revision !== context.expectedRevision) throw new ConflictError(context.expectedRevision, current.revision);
    transaction.delete(rehearsalRef);
    transaction.set(logRef, activityPayload(context.actor, "delete", [`稽古予定を削除（${formatRehearsalActivityDate(current.startAt)}）`]));
  });
}
