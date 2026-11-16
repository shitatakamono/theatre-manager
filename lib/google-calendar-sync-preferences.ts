import type { CastMember, StaffRole } from "./performance.ts";
import {
  REHEARSAL_TYPES,
  type RehearsalType,
} from "./rehearsals.ts";
import {
  shouldSyncRehearsalForPerson,
  type GoogleCalendarSyncPerson,
} from "./google-calendar-sync.ts";

export const GOOGLE_CALENDAR_SYNC_TYPES = [...REHEARSAL_TYPES] as RehearsalType[];

export function normalizeGoogleCalendarSyncTypes(values: Iterable<string>): RehearsalType[] {
  const selected = new Set(values);
  return GOOGLE_CALENDAR_SYNC_TYPES.filter((type) => selected.has(type));
}

export function parseGoogleCalendarSyncTypes(value: unknown): RehearsalType[] {
  if (!Array.isArray(value)
    || value.some((type) => typeof type !== "string" || !GOOGLE_CALENDAR_SYNC_TYPES.includes(type as RehearsalType))
    || new Set(value).size !== value.length) {
    throw new Error("同期する稽古の指定が不正です");
  }
  return normalizeGoogleCalendarSyncTypes(value);
}

export function getLegacyGoogleCalendarSyncTypes(
  person: GoogleCalendarSyncPerson<RehearsalType>,
  cast: readonly CastMember[],
  staff: readonly StaffRole[]
): RehearsalType[] {
  return GOOGLE_CALENDAR_SYNC_TYPES.filter((type) =>
    shouldSyncRehearsalForPerson(person, { type }, cast, staff)
  );
}

export function resolveGoogleCalendarSyncTypes(input: {
  person: GoogleCalendarSyncPerson<RehearsalType>;
  cast: readonly CastMember[];
  staff: readonly StaffRole[];
  configuredTypes: readonly RehearsalType[] | null;
}): RehearsalType[] {
  if (!input.person.active) return [];
  return input.configuredTypes === null
    ? getLegacyGoogleCalendarSyncTypes(input.person, input.cast, input.staff)
    : normalizeGoogleCalendarSyncTypes(input.configuredTypes);
}

export function filterGoogleCalendarSyncRehearsals<Rehearsal extends { type: string }>(
  rehearsals: readonly Rehearsal[],
  selectedTypes: Iterable<string>
): Rehearsal[] {
  const selected = new Set(normalizeGoogleCalendarSyncTypes(selectedTypes));
  return rehearsals.filter((rehearsal) => selected.has(rehearsal.type as RehearsalType));
}

export function isUpcomingGoogleCalendarRehearsal(
  rehearsal: { startAt: string },
  now = new Date()
): boolean {
  const startMillis = Date.parse(rehearsal.startAt);
  return Number.isFinite(startMillis) && startMillis >= now.getTime();
}
