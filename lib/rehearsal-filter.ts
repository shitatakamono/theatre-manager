import {
  REHEARSAL_TYPES,
  type Rehearsal,
  type RehearsalType,
} from "./rehearsals.ts";

export const ALL_REHEARSAL_FILTER_TYPES = [...REHEARSAL_TYPES] as RehearsalType[];

export function normalizeRehearsalFilterTypes(values: Iterable<string>): RehearsalType[] {
  const selected = new Set(values);
  return ALL_REHEARSAL_FILTER_TYPES.filter((type) => selected.has(type));
}

export function filterRehearsalsByTypes(
  rehearsals: readonly Rehearsal[],
  selectedTypes: Iterable<string>
): Rehearsal[] {
  const selected = new Set(normalizeRehearsalFilterTypes(selectedTypes));
  return rehearsals.filter((rehearsal) => selected.has(rehearsal.type));
}

export function serializeRehearsalFilterTypes(selectedTypes: Iterable<string>): string {
  return normalizeRehearsalFilterTypes(selectedTypes).join(",");
}

export function parseRehearsalFilterTypes(value: string | null | undefined): RehearsalType[] {
  if (value == null) return [...ALL_REHEARSAL_FILTER_TYPES];
  if (value.trim() === "") return [];
  return normalizeRehearsalFilterTypes(value.split(","));
}
