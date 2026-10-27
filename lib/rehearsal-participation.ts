export const REHEARSAL_PARTICIPATION_OPTIONS = [
  { value: "acting", label: "芝居" },
  { value: "japanese_dance", label: "日本舞踊" },
  { value: "stage_combat", label: "殺陣" },
] as const;

export type RehearsalParticipationType = (typeof REHEARSAL_PARTICIPATION_OPTIONS)[number]["value"];

export const REHEARSAL_PARTICIPATION_TYPES = REHEARSAL_PARTICIPATION_OPTIONS.map(({ value }) => value);

export const REHEARSAL_PARTICIPATION_LABELS = Object.fromEntries(
  REHEARSAL_PARTICIPATION_OPTIONS.map(({ value, label }) => [value, label])
) as Record<RehearsalParticipationType, string>;

function isParticipationType(value: unknown): value is RehearsalParticipationType {
  return typeof value === "string"
    && REHEARSAL_PARTICIPATION_TYPES.includes(value as RehearsalParticipationType);
}

function sortTypes(values: Iterable<RehearsalParticipationType>): RehearsalParticipationType[] {
  const selected = new Set(values);
  return REHEARSAL_PARTICIPATION_TYPES.filter((type) => selected.has(type));
}

export function getLegacyRehearsalParticipationTypes(specialPractice: unknown): RehearsalParticipationType[] {
  if (specialPractice === "stage_combat") return ["acting", "stage_combat"];
  if (specialPractice === "japanese_dance") return ["acting", "japanese_dance"];
  return ["acting"];
}

export function normalizeRehearsalParticipationTypes(
  value: unknown,
  legacySpecialPractice: unknown
): RehearsalParticipationType[] {
  if (!Array.isArray(value)) return getLegacyRehearsalParticipationTypes(legacySpecialPractice);
  return sortTypes(value.filter(isParticipationType));
}

export function buildRehearsalParticipationTypes(
  value: readonly RehearsalParticipationType[] | undefined,
  legacySpecialPractice: unknown
): RehearsalParticipationType[] {
  if (value === undefined) return getLegacyRehearsalParticipationTypes(legacySpecialPractice);
  if (value.some((type) => !isParticipationType(type))) {
    throw new Error("参加する稽古の指定が不正です");
  }
  if (new Set(value).size !== value.length) throw new Error("参加する稽古が重複しています");
  return sortTypes(value);
}

export function formatRehearsalParticipationTypes(types: readonly RehearsalParticipationType[]): string {
  return types.map((type) => REHEARSAL_PARTICIPATION_LABELS[type]).join(" / ") || "—";
}

export function toggleRehearsalParticipationType(
  current: readonly RehearsalParticipationType[],
  type: RehearsalParticipationType,
  selected: boolean
): RehearsalParticipationType[] {
  const next = new Set(current);
  if (selected) next.add(type);
  else next.delete(type);
  return sortTypes(next);
}
