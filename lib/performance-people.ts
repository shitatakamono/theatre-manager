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

export type PreparedPerformancePeople = {
  value: CastMember[] | StaffRole[];
  peopleDrafts: PerformancePersonDraft[];
  createdPersonIds: string[];
};

export type ResolvedPerformancePerson = {
  person: ProjectPerson | null;
  managementName: string;
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
  if (!personId) throw new Error("関係者IDが不正です");
  return {
    id: personId,
    values: buildProjectPersonValues({
      displayName,
      attendanceTarget: input.attendanceTarget ?? false,
      specialPractice: input.specialPractice ?? "none",
      rehearsalParticipationTypes: input.rehearsalParticipationTypes ?? [],
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
      rehearsalParticipationTypes: person.rehearsalParticipationTypes,
      linkedUserUid: person.linkedUserUid,
      publicNote: person.publicNote,
      active: person.active,
    }),
  };
}

export function getSelectablePerformancePeople(
  people: readonly ProjectPerson[],
  selectedPersonId?: string
): ProjectPerson[] {
  return people.filter((person) => person.active || person.id === selectedPersonId);
}

export function preparePerformancePeopleForSave(
  section: "cast" | "staff",
  value: readonly CastMember[] | readonly StaffRole[],
  currentValue: readonly CastMember[] | readonly StaffRole[],
  peopleDrafts: readonly PerformancePersonDraft[],
  createPersonId: () => string
): PreparedPerformancePeople {
  const currentEntryIds = new Set(section === "cast"
    ? (currentValue as readonly CastMember[]).map((member) => member.id)
    : (currentValue as readonly StaffRole[]).flatMap((role) => role.members.map((member) => member.id)));
  const nextDrafts = [...peopleDrafts];
  const createdPersonIds: string[] = [];

  function linkNewEntry<T extends CastMember | StaffMember>(member: T): T {
    if (member.personId || currentEntryIds.has(member.id)) return { ...member };
    const person = buildNewPerformancePerson(createPersonId(), member.name, {
      rehearsalParticipationTypes: section === "cast" ? ["acting"] : [],
    });
    nextDrafts.push(person);
    createdPersonIds.push(person.id);
    return { ...member, personId: person.id };
  }

  const preparedValue = section === "cast"
    ? (value as readonly CastMember[]).map(linkNewEntry)
    : (value as readonly StaffRole[]).map((role) => ({
      ...role,
      members: role.members.map(linkNewEntry),
    }));

  return { value: preparedValue, peopleDrafts: nextDrafts, createdPersonIds };
}

export function resolveCastMemberPerson(
  member: CastMember,
  people: readonly ProjectPerson[]
): ResolvedPerformancePerson {
  const personId = normalizePersonId(member.personId);
  const person = personId ? people.find(({ id }) => id === personId) ?? null : null;
  const managementName = person?.displayName || member.name;
  return {
    person,
    managementName,
    creditName: member.displayName?.trim() || managementName,
  };
}

export function resolveStaffMemberPerson(
  member: StaffMember,
  people: readonly ProjectPerson[]
): ResolvedPerformancePerson {
  const personId = normalizePersonId(member.personId);
  const person = personId ? people.find(({ id }) => id === personId) ?? null : null;
  const managementName = person?.displayName || member.name;
  return {
    person,
    managementName,
    creditName: member.creditName?.trim() || managementName,
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
