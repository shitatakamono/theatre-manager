import type { CastMember, StaffRole } from "./performance.ts";
import {
  getCastPersonIds,
  getStaffPersonIds,
} from "./performance-people.ts";

export type GoogleCalendarSyncPerson<CategoryId extends string = string> = {
  id: string;
  active: boolean;
  rehearsalParticipationTypes?: readonly CategoryId[];
};

export type GoogleCalendarSyncRehearsal<CategoryId extends string = string> = {
  type: CategoryId;
};

export function shouldSyncRehearsalForPerson<CategoryId extends string>(
  person: GoogleCalendarSyncPerson<CategoryId>,
  rehearsal: GoogleCalendarSyncRehearsal<CategoryId>,
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): boolean {
  if (!person.active) return false;

  const castLinked = getCastPersonIds(cast).includes(person.id);
  const staffLinked = getStaffPersonIds(staff).includes(person.id);

  if (staffLinked && !castLinked) return true;

  return (person.rehearsalParticipationTypes ?? []).includes(rehearsal.type);
}
