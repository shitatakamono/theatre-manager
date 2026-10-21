import type { AttendanceInput, AttendanceRecord, AttendanceStatus } from "./attendance.ts";
import type { RehearsalDaySummary } from "./attendance-view.ts";
import type { Participant } from "./participants.ts";

export type AttendanceManagementFilter = "all" | "unanswered" | "tentative";

export type AttendanceManagementCell = {
  date: string;
  record: AttendanceRecord | null;
};

export type AttendanceManagementRow = {
  participant: Participant;
  cells: AttendanceManagementCell[];
};

export type AttendanceManagementDraft = {
  status: AttendanceStatus | null;
  availableFrom: string | null;
  availableUntil: string | null;
  publicNote: string;
};

export function buildAttendanceManagementMatrix(
  participants: readonly Participant[],
  days: readonly Pick<RehearsalDaySummary, "date">[],
  records: readonly AttendanceRecord[],
  filter: AttendanceManagementFilter = "all"
): AttendanceManagementRow[] {
  const sortedDays = [...days].sort((left, right) => left.date.localeCompare(right.date));
  const recordByKey = new Map(records.map((record) => [`${record.date}_${record.participantId}`, record]));
  return participants
    .filter((participant) => participant.active)
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "ja"))
    .map((participant) => ({
      participant,
      cells: sortedDays.map(({ date }) => ({
        date,
        record: recordByKey.get(`${date}_${participant.id}`) ?? null,
      })),
    }))
    .filter((row) => filter === "all"
      || (filter === "unanswered" && row.cells.some(({ record }) => record === null))
      || (filter === "tentative" && row.cells.some(({ record }) => record?.status === "tentative")));
}

export function buildManagementDraft(record: AttendanceRecord | null): AttendanceManagementDraft {
  return record ? {
    status: record.status,
    availableFrom: record.availableFrom,
    availableUntil: record.availableUntil,
    publicNote: record.publicNote,
  } : {
    status: null,
    availableFrom: null,
    availableUntil: null,
    publicNote: "",
  };
}

export function buildChangedManagementInput(
  participantId: string,
  date: string,
  draft: AttendanceManagementDraft,
  record: AttendanceRecord | null
): AttendanceInput | null {
  if (draft.status === null) return null;
  const availableFrom = draft.status === "attending" ? draft.availableFrom : null;
  const availableUntil = draft.status === "attending" ? draft.availableUntil : null;
  const publicNote = draft.publicNote.trim();
  if (record
    && record.status === draft.status
    && record.availableFrom === availableFrom
    && record.availableUntil === availableUntil
    && record.publicNote === publicNote) return null;
  return { participantId, date, status: draft.status, availableFrom, availableUntil, publicNote };
}

export function getManagementDraftError(draft: AttendanceManagementDraft): string | null {
  if (draft.status === null) return "参加・不参加・未定を選択してください";
  if (draft.status !== "attending") return null;
  if (!draft.availableFrom || !draft.availableUntil) return "参加可能時間を入力してください";
  if (draft.availableFrom >= draft.availableUntil) return "終了時刻は開始時刻より後にしてください";
  return null;
}

export function formatAttendanceCell(record: AttendanceRecord | null): string {
  if (!record) return "未回答";
  if (record.status === "absent") return "× 不参加";
  if (record.status === "tentative") return "△ 未定";
  return `○ ${record.availableFrom ?? "--:--"}〜${record.availableUntil ?? "--:--"}`;
}
