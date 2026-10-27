import type { CastMember, StaffRole } from "./performance.ts";
import type { ProjectPerson } from "./people.ts";
import { normalizeRehearsalParticipationTypes } from "./rehearsal-participation.ts";
import type { Rehearsal } from "./rehearsals.ts";

export type AttendanceParticipationMode = "required" | "optional_staff" | "disabled";
export type AttendanceDayRequirement = "required" | "optional" | "not_applicable";

type AttendancePerson = Pick<
  ProjectPerson,
  "id" | "active" | "attendanceTarget" | "specialPractice" | "rehearsalParticipationTypes"
>;

function hasCastLink(personId: string, cast: readonly CastMember[]): boolean {
  return cast.some((member) => member.personId === personId);
}

function hasStaffLink(personId: string, staff: readonly StaffRole[]): boolean {
  return staff.some((role) => role.members.some((member) => member.personId === personId));
}

export function getAttendanceParticipationMode(
  person: AttendancePerson,
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): AttendanceParticipationMode {
  if (!person.active || !person.attendanceTarget) return "disabled";
  const castLinked = hasCastLink(person.id, cast);
  return !castLinked && hasStaffLink(person.id, staff) ? "optional_staff" : "required";
}

export function isAttendanceRequiredForRehearsal(
  person: AttendancePerson,
  rehearsal: Pick<Rehearsal, "type">,
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): boolean {
  if (getAttendanceParticipationMode(person, cast, staff) !== "required") return false;
  const selectedTypes = normalizeRehearsalParticipationTypes(
    person.rehearsalParticipationTypes,
    person.specialPractice
  );
  return selectedTypes.includes(rehearsal.type as typeof selectedTypes[number]);
}

export function getAttendanceDayRequirement(
  person: AttendancePerson,
  rehearsals: readonly Pick<Rehearsal, "type">[],
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): AttendanceDayRequirement {
  const mode = getAttendanceParticipationMode(person, cast, staff);
  if (mode === "disabled") return "not_applicable";
  if (mode === "optional_staff") return "optional";
  return rehearsals.some((rehearsal) => isAttendanceRequiredForRehearsal(person, rehearsal, cast, staff))
    ? "required"
    : "not_applicable";
}

export function getSelfAttendanceRehearsals(
  person: AttendancePerson,
  rehearsals: readonly Rehearsal[],
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): Rehearsal[] {
  const mode = getAttendanceParticipationMode(person, cast, staff);
  if (mode === "disabled") return [];
  if (mode === "optional_staff") return [...rehearsals];
  return rehearsals.filter((rehearsal) => isAttendanceRequiredForRehearsal(person, rehearsal, cast, staff));
}
