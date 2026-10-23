import type { ProjectRole } from "./auth.ts";
import type { AttendanceRecord } from "./attendance.ts";
import { findSelfParticipant } from "./attendance-view.ts";
import type { Participant } from "./participants.ts";

export type DashboardAttendanceSummary = {
  label: "未回答出欠" | "あなたの未回答";
  value: string;
  detail: string;
  href: string;
};

function countUnanswered(
  participants: readonly Pick<Participant, "id">[],
  dates: readonly string[],
  records: readonly Pick<AttendanceRecord, "participantId" | "date">[]
): number {
  const answeredKeys = new Set(records.map((record) => `${record.date}_${record.participantId}`));
  return participants.reduce(
    (count, participant) => count + dates.filter((date) => !answeredKeys.has(`${date}_${participant.id}`)).length,
    0
  );
}

export function buildDashboardAttendanceSummary(
  projectId: string,
  role: ProjectRole | undefined,
  currentUid: string,
  participants: readonly Participant[],
  upcomingDates: readonly string[],
  records: readonly AttendanceRecord[]
): DashboardAttendanceSummary {
  const base = `/projects/${projectId}/attendance`;
  if (role === "owner" || role === "editor") {
    const activeParticipants = participants.filter(({ active }) => active);
    return {
      label: "未回答出欠",
      value: `${countUnanswered(activeParticipants, upcomingDates, records)}件`,
      detail: `${upcomingDates.length}日分の今後の稽古`,
      href: `${base}/manage`,
    };
  }

  const selfParticipant = findSelfParticipant(participants, currentUid);
  if (!selfParticipant?.active) {
    return {
      label: "あなたの未回答",
      value: "未連携",
      detail: "参加者情報との紐付けが必要です",
      href: base,
    };
  }
  return {
    label: "あなたの未回答",
    value: `${countUnanswered([selfParticipant], upcomingDates, records)}件`,
    detail: `${upcomingDates.length}日分の今後の稽古`,
    href: base,
  };
}
