import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  where,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";

export const ATTENDANCE_STATUSES = ["attending", "absent", "tentative"] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type AttendanceInput = {
  participantId: string;
  date: string;
  status: AttendanceStatus;
  availableFrom: string | null;
  availableUntil: string | null;
  publicNote: string;
};

export type AttendanceValues = AttendanceInput;

export type AttendanceRecord = AttendanceValues & {
  id: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  createdByUid: string;
  updatedByUid: string;
};

export type AttendanceUpsertResult = {
  id: string;
  created: boolean;
};

async function resolveFirestore(firestore?: Firestore): Promise<Firestore> {
  if (firestore) return firestore;
  return (await import("./firebase.ts")).db;
}

function validDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function validTimeString(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function normalizeParticipantId(value: string): string {
  const participantId = value.trim();
  if (!participantId || participantId.length > 128 || participantId.includes("/")) {
    throw new Error("参加者情報が不正です");
  }
  return participantId;
}

function normalizeDate(value: string): string {
  const date = value.trim();
  if (!validDateString(date)) throw new Error("日付はYYYY-MM-DD形式で入力してください");
  return date;
}

function normalizeOptionalTime(value: string | null): string | null {
  const time = value?.trim() || null;
  if (time !== null && !validTimeString(time)) throw new Error("時刻はHH:mm形式で入力してください");
  return time;
}

export function buildAttendanceRecordId(date: string, participantId: string): string {
  return `${normalizeDate(date)}_${normalizeParticipantId(participantId)}`;
}

export function buildAttendanceValues(input: AttendanceInput): AttendanceValues {
  const participantId = normalizeParticipantId(input.participantId);
  const date = normalizeDate(input.date);
  if (!ATTENDANCE_STATUSES.includes(input.status)) throw new Error("出欠状況が不正です");

  const availableFrom = normalizeOptionalTime(input.availableFrom);
  const availableUntil = normalizeOptionalTime(input.availableUntil);
  if (input.status === "attending") {
    if (availableFrom === null || availableUntil === null) {
      throw new Error("参加の場合は参加可能時間を入力してください");
    }
    if (availableFrom >= availableUntil) {
      throw new Error("終了時刻は開始時刻より後にしてください");
    }
  } else if (availableFrom !== null || availableUntil !== null) {
    throw new Error("不参加または未定の場合は時間を指定できません");
  }

  const publicNote = input.publicNote.trim();
  if (publicNote.length > 2000) throw new Error("公開備考は2000文字以内で入力してください");
  return { participantId, date, status: input.status, availableFrom, availableUntil, publicNote };
}

function mapAttendanceRecord(snapshot: QueryDocumentSnapshot): AttendanceRecord {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    participantId: typeof data.participantId === "string" ? data.participantId : "",
    date: typeof data.date === "string" ? data.date : "",
    status: ATTENDANCE_STATUSES.includes(data.status as AttendanceStatus)
      ? data.status as AttendanceStatus
      : "tentative",
    availableFrom: typeof data.availableFrom === "string" ? data.availableFrom : null,
    availableUntil: typeof data.availableUntil === "string" ? data.availableUntil : null,
    publicNote: typeof data.publicNote === "string" ? data.publicNote : "",
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    createdByUid: typeof data.createdByUid === "string" ? data.createdByUid : "",
    updatedByUid: typeof data.updatedByUid === "string" ? data.updatedByUid : "",
  };
}

function sortAttendanceRecords(records: AttendanceRecord[]): AttendanceRecord[] {
  return records.sort((left, right) => left.date.localeCompare(right.date)
    || left.participantId.localeCompare(right.participantId));
}

export async function getProjectAttendanceRecords(
  projectId: string,
  firestore?: Firestore
): Promise<AttendanceRecord[]> {
  const database = await resolveFirestore(firestore);
  const snapshot = await getDocs(collection(database, "projects", projectId, "attendanceRecords"));
  return sortAttendanceRecords(snapshot.docs.map(mapAttendanceRecord));
}

export async function getParticipantAttendanceRecords(
  projectId: string,
  participantId: string,
  firestore?: Firestore
): Promise<AttendanceRecord[]> {
  const normalizedParticipantId = normalizeParticipantId(participantId);
  const database = await resolveFirestore(firestore);
  const records = collection(database, "projects", projectId, "attendanceRecords");
  const snapshot = await getDocs(query(records, where("participantId", "==", normalizedParticipantId)));
  return sortAttendanceRecords(snapshot.docs.map(mapAttendanceRecord));
}

export async function upsertProjectAttendanceRecords(
  projectId: string,
  inputs: readonly AttendanceInput[],
  actorUid: string,
  firestore?: Firestore
): Promise<AttendanceUpsertResult[]> {
  const normalizedActorUid = actorUid.trim();
  if (!normalizedActorUid) throw new Error("更新者情報が不正です");
  if (inputs.length === 0) throw new Error("出欠予定を1件以上指定してください");
  if (inputs.length > 100) throw new Error("一度に保存できる出欠予定は100件までです");

  const values = inputs.map(buildAttendanceValues);
  const ids = values.map(({ date, participantId }) => buildAttendanceRecordId(date, participantId));
  if (new Set(ids).size !== ids.length) throw new Error("同じ参加者・同じ日付の出欠予定が重複しています");

  const database = await resolveFirestore(firestore);
  const references = ids.map((id) => doc(database, "projects", projectId, "attendanceRecords", id));
  return runTransaction(database, async (transaction) => {
    const snapshots = await Promise.all(references.map((reference) => transaction.get(reference)));
    snapshots.forEach((snapshot, index) => {
      if (snapshot.exists()) {
        transaction.update(references[index], {
          ...values[index],
          updatedAt: serverTimestamp(),
          updatedByUid: normalizedActorUid,
        });
      } else {
        transaction.set(references[index], {
          ...values[index],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdByUid: normalizedActorUid,
          updatedByUid: normalizedActorUid,
        });
      }
    });
    return ids.map((id, index) => ({ id, created: !snapshots[index].exists() }));
  });
}

export async function upsertProjectAttendanceRecord(
  projectId: string,
  input: AttendanceInput,
  actorUid: string,
  firestore?: Firestore
): Promise<AttendanceUpsertResult> {
  const [result] = await upsertProjectAttendanceRecords(projectId, [input], actorUid, firestore);
  return result;
}
