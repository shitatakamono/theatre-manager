import type { CastMember, StaffRole } from "./performance.ts";
import {
  shouldSyncRehearsalForPerson,
  type GoogleCalendarSyncPerson,
} from "./google-calendar-sync.ts";

export type GoogleCalendarSyncPreviewRehearsal<
  CategoryId extends string = string,
> = {
  rehearsalId: string;
  startAt: string;
  endAt: string | null;
  type: CategoryId;
  customType: string;
  venue: string;
  content: string;
};

export type GoogleCalendarSyncSourceRehearsal =
  GoogleCalendarSyncPreviewRehearsal<string> & {
    note: string;
    revision: number;
  };

export type GoogleCalendarSyncPreview<
  CategoryId extends string = string,
  Rehearsal extends GoogleCalendarSyncPreviewRehearsal<CategoryId> = GoogleCalendarSyncPreviewRehearsal<CategoryId>,
> = {
  linked: boolean;
  totalRehearsals: number;
  targetCount: number;
  rehearsals: Rehearsal[];
};

export function buildGoogleCalendarSyncPreview<
  CategoryId extends string,
  Rehearsal extends GoogleCalendarSyncPreviewRehearsal<CategoryId>,
>(
  person: GoogleCalendarSyncPerson<CategoryId> | null,
  rehearsals: readonly Rehearsal[],
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): GoogleCalendarSyncPreview<CategoryId, Rehearsal> {
  if (!person) {
    return {
      linked: false,
      totalRehearsals: rehearsals.length,
      targetCount: 0,
      rehearsals: [],
    };
  }

  const targets = rehearsals.filter((rehearsal) =>
    shouldSyncRehearsalForPerson(person, rehearsal, cast, staff)
  );

  return {
    linked: true,
    totalRehearsals: rehearsals.length,
    targetCount: targets.length,
    rehearsals: targets,
  };
}
