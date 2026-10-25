import type { CastMember, StaffMember, StaffRole } from "./performance.ts";
import {
  buildProjectPersonValues,
  type ProjectPerson,
  type ProjectPersonInput,
  type ProjectPersonValues,
} from "./people.ts";

export type PerformancePersonDraft = {
  id: string;
  values: ProjectPersonValues;
};

export type ResolvedPerformancePerson = {
  person: ProjectPerson | null;
  internalName: string;
  creditName: string;
};

function normalizePersonId(personId: string | undefined): string | null {
  const normalized = personId?.trim() ?? "";
  return normalized || null;
}

export function buildNewPerformancePerson(
  id: string,
  displayName: string,
  input: Partial<Omit<ProjectPersonInput, "displayName">> = {}
): PerformancePersonDraft {
  const personId = id.trim();
  if (!personId) throw new Error("人物IDが不正です");
  return {
    id: personId,
    values: buildProjectPersonValues({
      displayName,
      attendanceTarget: input.attendanceTarget ?? false,
      specialPractice: input.specialPractice ?? "none",
      linkedUserUid: input.linkedUserUid ?? null,
      publicNote: input.publicNote ?? "",
      active: input.active ?? true,
    }),
  };
}

export function projectPersonToPerformanceDraft(person: ProjectPerson): PerformancePersonDraft {
  return {
    id: person.id,
    values: buildProjectPersonValues({
      displayName: person.displayName,
      attendanceTarget: person.attendanceTarget,
      specialPractice: person.specialPractice,
      linkedUserUid: person.linkedUserUid,
      publicNote: person.publicNote,
      active: person.active,
    }),
  };
}

export function resolveCastMemberPerson(
  member: CastMember,
  people: readonly ProjectPerson[]
): ResolvedPerformancePerson {
  const personId = normalizePersonId(member.personId);
  const person = personId ? people.find(({ id }) => id === personId) ?? null : null;
  const internalName = person?.displayName || member.name;
  return {
    person,
    internalName,
    creditName: member.displayName?.trim() || internalName,
  };
}

export function resolveStaffMemberPerson(
  member: StaffMember,
  people: readonly ProjectPerson[]
): ResolvedPerformancePerson {
  const personId = normalizePersonId(member.personId);
  const person = personId ? people.find(({ id }) => id === personId) ?? null : null;
  const internalName = person?.displayName || member.name;
  return {
    person,
    internalName,
    creditName: member.creditName?.trim() || internalName,
  };
}

export function getCastPersonIds(cast: readonly CastMember[]): string[] {
  return [...new Set(cast.flatMap((member) => {
    const personId = normalizePersonId(member.personId);
    return personId ? [personId] : [];
  }))];
}

export function getStaffPersonIds(staff: readonly StaffRole[]): string[] {
  return [...new Set(staff.flatMap((role) => role.members.flatMap((member) => {
    const personId = normalizePersonId(member.personId);
    return personId ? [personId] : [];
  })))];
}

export function getPerformancePersonIds(
  section: "cast" | "staff",
  value: readonly CastMember[] | readonly StaffRole[]
): string[] {
  return section === "cast"
    ? getCastPersonIds(value as readonly CastMember[])
    : getStaffPersonIds(value as readonly StaffRole[]);
}
