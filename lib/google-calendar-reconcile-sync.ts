export type GoogleCalendarReconcileRehearsal = {
  rehearsalId: string;
};

export type GoogleCalendarReconcileMapping = {
  projectId: string;
  rehearsalId: string;
};

export type GoogleCalendarReconcileSyncPlan<
  Rehearsal extends GoogleCalendarReconcileRehearsal,
  Mapping extends GoogleCalendarReconcileMapping,
> = {
  totalRehearsals: number;
  desiredCount: number;
  mappedCount: number;
  createTargets: Rehearsal[];
  deleteTargets: Mapping[];
};

export type GoogleCalendarReconcileOperationResult = {
  createdCount: number;
  deletedCount: number;
  alreadyMissingCount: number;
  failedCount: number;
  errorCodes: string[];
};

export function buildGoogleCalendarReconcileSyncPlan<
  Rehearsal extends GoogleCalendarReconcileRehearsal,
  Mapping extends GoogleCalendarReconcileMapping,
>(input: {
  projectId: string;
  allRehearsals: readonly Rehearsal[];
  desiredRehearsals: readonly Rehearsal[];
  mappings: readonly Mapping[];
}): GoogleCalendarReconcileSyncPlan<Rehearsal, Mapping> {
  const allRehearsalIds = new Set(
    input.allRehearsals.map(({ rehearsalId }) => rehearsalId)
  );
  const desiredRehearsalIds = new Set(
    input.desiredRehearsals.map(({ rehearsalId }) => rehearsalId)
  );
  const projectMappings = input.mappings.filter(
    (mapping) => mapping.projectId === input.projectId
  );
  const mappedRehearsalIds = new Set(
    projectMappings.map(({ rehearsalId }) => rehearsalId)
  );

  return {
    totalRehearsals: input.allRehearsals.length,
    desiredCount: input.desiredRehearsals.length,
    mappedCount: projectMappings.length,
    createTargets: input.desiredRehearsals.filter(
      ({ rehearsalId }) => !mappedRehearsalIds.has(rehearsalId)
    ),
    // Deleted rehearsal documents belong to G3-3, not this reconciliation.
    deleteTargets: projectMappings.filter(({ rehearsalId }) =>
      allRehearsalIds.has(rehearsalId)
      && !desiredRehearsalIds.has(rehearsalId)
    ),
  };
}

export function combineGoogleCalendarReconcileResults(input: {
  creation: {
    createdCount: number;
    failedCount: number;
    errorCodes: readonly string[];
  };
  deletion: {
    deletedCount: number;
    alreadyMissingCount: number;
    failedCount: number;
    errorCodes: readonly string[];
  };
}): GoogleCalendarReconcileOperationResult {
  return {
    createdCount: input.creation.createdCount,
    deletedCount: input.deletion.deletedCount,
    alreadyMissingCount: input.deletion.alreadyMissingCount,
    failedCount: input.creation.failedCount + input.deletion.failedCount,
    errorCodes: [...new Set([
      ...input.creation.errorCodes,
      ...input.deletion.errorCodes,
    ])],
  };
}

export async function runGoogleCalendarReconcileOperations(input: {
  create(): Promise<{
    createdCount: number;
    failedCount: number;
    errorCodes: string[];
  }>;
  delete(): Promise<{
    deletedCount: number;
    alreadyMissingCount: number;
    failedCount: number;
    errorCodes: string[];
  }>;
}): Promise<GoogleCalendarReconcileOperationResult> {
  const creation = await input.create();
  // Item-level creation failures must not prevent independent deletions.
  const deletion = await input.delete();
  return combineGoogleCalendarReconcileResults({ creation, deletion });
}
