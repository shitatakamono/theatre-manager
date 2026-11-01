export type GoogleCalendarRelatedProjectCandidate = {
  projectId: string;
  memberExists: boolean;
  linkedParticipantId: string | null;
  personExists: boolean;
};

export type GoogleCalendarReconnectCatchUpResult = {
  projectCount: number;
  enqueuedCount: number;
  failedCount: number;
  errorCodes: string[];
};

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

export function selectGoogleCalendarRelatedProjectIds(input: {
  linkedProjectCandidates: readonly GoogleCalendarRelatedProjectCandidate[];
  waitingJobProjectIds: Iterable<string>;
}): string[] {
  const linkedProjectIds = input.linkedProjectCandidates.flatMap((candidate) => {
    const projectId = candidate.projectId.trim();
    const participantId = candidate.linkedParticipantId?.trim() ?? "";
    return projectId
      && candidate.memberExists
      && participantId
      && candidate.personExists
      ? [projectId]
      : [];
  });
  return sortedUnique([...linkedProjectIds, ...input.waitingJobProjectIds]);
}

export async function runGoogleCalendarReconnectCatchUp(input: {
  uid: string;
  discoverProjectIds: (uid: string) => Promise<string[]>;
  enqueue: (request: {
    uid: string;
    projectId: string;
    reason: "google_reconnected";
  }) => Promise<unknown>;
}): Promise<GoogleCalendarReconnectCatchUpResult> {
  let projectIds: string[];
  try {
    projectIds = sortedUnique(await input.discoverProjectIds(input.uid));
  } catch {
    return {
      projectCount: 0,
      enqueuedCount: 0,
      failedCount: 1,
      errorCodes: ["reconnect_project_discovery_failed"],
    };
  }

  let enqueuedCount = 0;
  let failedCount = 0;
  for (const projectId of projectIds) {
    try {
      await input.enqueue({
        uid: input.uid,
        projectId,
        reason: "google_reconnected",
      });
      enqueuedCount += 1;
    } catch {
      failedCount += 1;
    }
  }
  return {
    projectCount: projectIds.length,
    enqueuedCount,
    failedCount,
    errorCodes: failedCount > 0 ? ["reconnect_enqueue_failed"] : [],
  };
}
