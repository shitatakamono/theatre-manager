export type GoogleCalendarLinkedUserCandidate = {
  uid: string;
  participantId: string;
};

export type GoogleCalendarConnectionCandidate = {
  uid: string;
  connected: boolean;
  credentialAvailable: boolean;
};

export type GoogleCalendarMappingOwnerCandidate = {
  uid: string;
  projectId: string;
};

export type GoogleCalendarSyncAudienceSkipReason =
  | "invalid_link"
  | "not_project_member"
  | "person_not_found"
  | "google_not_connected"
  | "invalid_connection";

export type GoogleCalendarSyncAudience = {
  normalSyncUids: string[];
  disconnectedUids: string[];
  mappingOwnerUids: string[];
  deleteCandidateUids: string[];
  allKnownSyncUids: string[];
  skippedUsers: Array<{
    uid: string;
    reason: GoogleCalendarSyncAudienceSkipReason;
  }>;
};

function normalizeIdentifier(value: string): string {
  return value.trim();
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set([...values].map(normalizeIdentifier).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function selectGoogleCalendarMappingOwnerUids(
  projectId: string,
  candidates: readonly GoogleCalendarMappingOwnerCandidate[]
): string[] {
  const normalizedProjectId = normalizeIdentifier(projectId);
  if (!normalizedProjectId) throw new Error("projectId is required");
  return sortedUnique(candidates
    .filter((candidate) =>
      normalizeIdentifier(candidate.projectId) === normalizedProjectId)
    .map((candidate) => candidate.uid));
}

export function buildGoogleCalendarProjectSyncAudience(input: {
  linkedUsers: readonly GoogleCalendarLinkedUserCandidate[];
  memberUids: Iterable<string>;
  personIds: Iterable<string>;
  connections: readonly GoogleCalendarConnectionCandidate[];
  mappingOwnerUids: Iterable<string>;
}): GoogleCalendarSyncAudience {
  const memberUids = new Set(sortedUnique(input.memberUids));
  const personIds = new Set(sortedUnique(input.personIds));
  const mappingOwnerUids = sortedUnique(input.mappingOwnerUids);
  const connections = new Map(
    input.connections
      .map((connection) => [normalizeIdentifier(connection.uid), connection] as const)
      .filter(([uid]) => uid)
  );

  const linkedByUid = new Map<string, string>();
  const invalidLinkUids = new Set<string>();
  for (const link of input.linkedUsers) {
    const uid = normalizeIdentifier(link.uid);
    const participantId = normalizeIdentifier(link.participantId);
    if (!uid) continue;
    if (!participantId || participantId.includes("/")) {
      invalidLinkUids.add(uid);
      continue;
    }
    const existing = linkedByUid.get(uid);
    if (existing && existing !== participantId) {
      invalidLinkUids.add(uid);
      linkedByUid.delete(uid);
      continue;
    }
    if (!invalidLinkUids.has(uid)) linkedByUid.set(uid, participantId);
  }

  const normalSyncUids: string[] = [];
  const disconnectedUids: string[] = [];
  const skippedUsers: GoogleCalendarSyncAudience["skippedUsers"] = [];
  const linkedUids = sortedUnique([
    ...linkedByUid.keys(),
    ...invalidLinkUids,
  ]);

  for (const uid of linkedUids) {
    if (invalidLinkUids.has(uid)) {
      skippedUsers.push({ uid, reason: "invalid_link" });
      continue;
    }
    const participantId = linkedByUid.get(uid);
    if (!participantId) continue;
    if (!memberUids.has(uid)) {
      skippedUsers.push({ uid, reason: "not_project_member" });
      continue;
    }
    if (!personIds.has(participantId)) {
      skippedUsers.push({ uid, reason: "person_not_found" });
      continue;
    }

    const connection = connections.get(uid);
    if (!connection?.connected) {
      disconnectedUids.push(uid);
      skippedUsers.push({ uid, reason: "google_not_connected" });
      continue;
    }
    if (!connection.credentialAvailable) {
      disconnectedUids.push(uid);
      skippedUsers.push({ uid, reason: "invalid_connection" });
      continue;
    }
    normalSyncUids.push(uid);
  }

  return {
    normalSyncUids,
    disconnectedUids,
    mappingOwnerUids,
    deleteCandidateUids: mappingOwnerUids,
    allKnownSyncUids: sortedUnique([...linkedUids, ...mappingOwnerUids]),
    skippedUsers,
  };
}
