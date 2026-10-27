import type { ProjectRole } from "./auth.ts";
import type { AttendanceRecord } from "./attendance.ts";
import { getAttendanceDayRequirement } from "./attendance-participation.ts";
import type { RehearsalDaySummary } from "./attendance-view.ts";
import { findSelfParticipant } from "./attendance-view.ts";
import type { CastMember, StaffRole } from "./performance.ts";
import type { ProjectPerson } from "./people.ts";

export type DashboardAttendanceSummary = {
  label: "未回答出欠" | "あなたの未回答";
  value: string;
  detail: string;
  href: string;
};

function countUnanswered(
  participants: readonly ProjectPerson[],
  days: readonly RehearsalDaySummary[],
  records: readonly Pick<AttendanceRecord, "participantId" | "date">[],
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): number {
  const answeredKeys = new Set(records.map((record) => `${record.date}_${record.participantId}`));
  return participants.reduce(
    (count, participant) => count + days.filter((day) => (
      getAttendanceDayRequirement(participant, day.rehearsals, cast, staff) === "required"
      && !answeredKeys.has(`${day.date}_${participant.id}`)
    )).length,
    0
  );
}

export function buildDashboardAttendanceSummary(
  projectId: string,
  role: ProjectRole | undefined,
  currentUid: string,
  participants: readonly ProjectPerson[],
  upcomingDays: readonly RehearsalDaySummary[],
  records: readonly AttendanceRecord[],
  cast: readonly CastMember[] = [],
  staff: readonly StaffRole[] = []
): DashboardAttendanceSummary {
  const base = `/projects/${projectId}/attendance`;
  if (role === "owner" || role === "editor") {
    const activeParticipants = participants.filter(({ active }) => active);
    return {
      label: "未回答出欠",
      value: `${countUnanswered(activeParticipants, upcomingDays, records, cast, staff)}件`,
      detail: `${upcomingDays.length}日分の今後の稽古`,
      href: `${base}/manage`,
    };
  }

  const selfParticipant = findSelfParticipant(participants, currentUid);
  if (!selfParticipant) {
    return {
      label: "あなたの未回答",
      value: "未連携",
      detail: "参加者情報との紐付けが必要です",
      href: base,
    };
  }
  if (!selfParticipant.active || !selfParticipant.attendanceTarget) {
    return {
      label: "あなたの未回答",
      value: "対象外",
      detail: "現在は出欠入力の対象外です",
      href: base,
    };
  }
  return {
    label: "あなたの未回答",
    value: `${countUnanswered([selfParticipant], upcomingDays, records, cast, staff)}件`,
    detail: `${upcomingDays.length}日分の今後の稽古`,
    href: base,
  };
}
