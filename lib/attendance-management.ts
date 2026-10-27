import type { AttendanceInput, AttendanceRecord, AttendanceStatus } from "./attendance.ts";
import { getAttendanceDayRequirement, type AttendanceDayRequirement } from "./attendance-participation.ts";
import type { RehearsalDaySummary } from "./attendance-view.ts";
import type { CastMember, StaffRole } from "./performance.ts";
import type { ProjectPerson } from "./people.ts";
import { sortManagedPeople, type ManagedPeopleSort } from "./people-management.ts";

export type AttendanceManagementFilter = "all" | "unanswered" | "tentative";

export type AttendanceManagementCell = {
  date: string;
  record: AttendanceRecord | null;
  requirement: AttendanceDayRequirement;
};

export type AttendanceManagementRow = {
  participant: ProjectPerson;
  cells: AttendanceManagementCell[];
};

export type AttendanceManagementDraft = {
  status: AttendanceStatus | null;
  availableFrom: string | null;
  availableUntil: string | null;
  publicNote: string;
};

export function buildAttendanceManagementMatrix(
  participants: readonly ProjectPerson[],
  days: readonly RehearsalDaySummary[],
  records: readonly AttendanceRecord[],
  filter: AttendanceManagementFilter = "all",
  cast: readonly CastMember[] = [],
  staff: readonly StaffRole[] = [],
  sort: ManagedPeopleSort = "name"
): AttendanceManagementRow[] {
  const sortedDays = [...days].sort((left, right) => left.date.localeCompare(right.date));
  const recordByKey = new Map(records.map((record) => [`${record.date}_${record.participantId}`, record]));
  return sortManagedPeople(
    participants.filter((participant) => participant.active),
    cast,
    staff,
    sort
  )
    .map((participant) => ({
      participant,
      cells: sortedDays.map(({ date, rehearsals }) => ({
        date,
        record: recordByKey.get(`${date}_${participant.id}`) ?? null,
        requirement: getAttendanceDayRequirement(participant, rehearsals, cast, staff),
      })),
    }))
    .filter((row) => filter === "all"
      || (filter === "unanswered" && row.cells.some(({ record, requirement }) => requirement === "required" && record === null))
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

export function formatAttendanceCell(
  record: AttendanceRecord | null,
  requirement: AttendanceDayRequirement = "required"
): string {
  if (!record) {
    if (requirement === "optional") return "参加予定なし";
    if (requirement === "not_applicable") return "対象外";
    return "未回答";
  }
  if (record.status === "absent") return "× 不参加";
  if (record.status === "tentative") return "△ 未定";
  return `○ ${record.availableFrom ?? "--:--"}〜${record.availableUntil ?? "--:--"}`;
}
