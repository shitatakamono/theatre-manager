export type GoogleCalendarDeleteSyncMapping = {
  projectId: string;
  rehearsalId: string;
};

export type GoogleCalendarDeleteSyncPlan<T extends GoogleCalendarDeleteSyncMapping> = {
  mappedCount: number;
  existingRehearsalCount: number;
  deleteTargets: T[];
};

export type GoogleCalendarDeleteProviderResult =
  | { status: "deleted"; providerStatus: number }
  | { status: "already_missing"; providerStatus: 404 }
  | { status: "failed"; code: string; providerStatus: number | null };

export type GoogleCalendarDeleteSyncOutcome =
  | { status: "deleted" }
  | { status: "already_missing" }
  | { status: "failed"; code: string };

export function buildGoogleCalendarDeleteSyncPlan<
  T extends GoogleCalendarDeleteSyncMapping,
>(
  projectId: string,
  mappings: readonly T[],
  existingRehearsalIds: ReadonlySet<string>
): GoogleCalendarDeleteSyncPlan<T> {
  const projectMappings = mappings.filter(
    (mapping) => mapping.projectId === projectId
  );
  const deleteTargets: T[] = [];
  let existingRehearsalCount = 0;

  for (const mapping of projectMappings) {
    if (existingRehearsalIds.has(mapping.rehearsalId)) {
      existingRehearsalCount += 1;
    } else {
      deleteTargets.push(mapping);
    }
  }

  return {
    mappedCount: projectMappings.length,
    existingRehearsalCount,
    deleteTargets,
  };
}

export function classifyGoogleCalendarDeleteResponse(
  status: number | null
): GoogleCalendarDeleteProviderResult {
  if (status !== null && status >= 200 && status < 300) {
    return { status: "deleted", providerStatus: status };
  }
  if (status === 404) {
    return { status: "already_missing", providerStatus: 404 };
  }

  let code = "event_delete_failed";
  if (status === null) code = "event_delete_network_failed";
  else if (status === 401) code = "event_delete_unauthorized";
  else if (status === 403) code = "event_delete_forbidden";
  else if (status === 429) code = "event_delete_rate_limited";
  else if (status >= 500) code = "event_delete_provider_failed";

  return { status: "failed", code, providerStatus: status };
}

export async function deleteGoogleCalendarMappedEvent(input: {
  deleteGoogleEvent(): Promise<GoogleCalendarDeleteProviderResult>;
  deleteMapping(): Promise<boolean>;
}): Promise<GoogleCalendarDeleteSyncOutcome> {
  const googleResult = await input.deleteGoogleEvent();
  if (googleResult.status === "failed") {
    return { status: "failed", code: googleResult.code };
  }

  try {
    const mappingDeleted = await input.deleteMapping();
    if (!mappingDeleted) {
      return { status: "failed", code: "event_delete_lease_lost" };
    }
  } catch {
    return { status: "failed", code: "mapping_delete_failed" };
  }

  return { status: googleResult.status };
}

export function summarizeGoogleCalendarDeleteSync(
  outcomes: readonly GoogleCalendarDeleteSyncOutcome[]
): {
  deletedCount: number;
  alreadyMissingCount: number;
  failedCount: number;
  errorCodes: string[];
} {
  let deletedCount = 0;
  let alreadyMissingCount = 0;
  let failedCount = 0;
  const errorCodes = new Set<string>();

  for (const outcome of outcomes) {
    if (outcome.status === "deleted") deletedCount += 1;
    else if (outcome.status === "already_missing") alreadyMissingCount += 1;
    else {
      failedCount += 1;
      errorCodes.add(outcome.code);
    }
  }

  return {
    deletedCount,
    alreadyMissingCount,
    failedCount,
    errorCodes: [...errorCodes],
  };
}
