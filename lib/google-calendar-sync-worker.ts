import {
  classifyGoogleCalendarSyncError,
  summarizeGoogleCalendarSyncResults,
  type GoogleCalendarSyncExecutionResult,
} from "./google-calendar-sync-job.ts";

export type GoogleCalendarSyncWorkerOperation =
  | "delete"
  | "reconcile"
  | "update";

export type GoogleCalendarSyncWorkerOperationResult = {
  success: boolean;
  errorCodes: readonly string[];
};

export type GoogleCalendarSyncWorkerClaim =
  | {
      kind: "acquired";
      operationId: string;
      claimedGeneration: number;
      reasons: readonly string[];
    }
  | { kind: "in_progress" | "not_ready" | "missing" };

export type GoogleCalendarSyncWorkerResult =
  | {
      kind: "not_claimed";
      claimKind: "in_progress" | "not_ready" | "missing";
      operations: [];
    }
  | {
      kind: "completed";
      completion: "succeeded" | "rescheduled";
      operations: GoogleCalendarSyncWorkerOperation[];
    }
  | {
      kind: "lease_lost";
      operations: GoogleCalendarSyncWorkerOperation[];
    }
  | {
      kind: "failed";
      jobStatus: string;
      errorCode: string;
      operations: GoogleCalendarSyncWorkerOperation[];
    };

export type GoogleCalendarSyncWorkerDependencies = {
  claim(): Promise<GoogleCalendarSyncWorkerClaim>;
  checkConnection(): Promise<GoogleCalendarSyncExecutionResult>;
  checkIdentity(): Promise<GoogleCalendarSyncExecutionResult>;
  runOperation(
    operation: GoogleCalendarSyncWorkerOperation
  ): Promise<GoogleCalendarSyncWorkerOperationResult>;
  complete(input: {
    operationId: string;
    claimedGeneration: number;
  }): Promise<"succeeded" | "rescheduled" | "rejected">;
  fail(input: {
    operationId: string;
    claimedGeneration: number;
    result: Exclude<GoogleCalendarSyncExecutionResult, { success: true }>;
  }): Promise<string>;
  classifyError(error: unknown): Exclude<
    GoogleCalendarSyncExecutionResult,
    { success: true }
  >;
};

const FULL_SYNC_OPERATIONS: readonly GoogleCalendarSyncWorkerOperation[] = [
  "delete",
  "reconcile",
  "update",
];

const RECONCILE_REASONS = new Set([
  "rehearsal_created",
  "person_changed",
  "participation_changed",
  "cast_staff_changed",
  "link_changed",
]);

const STOP_AFTER_ERROR_CODES = new Set([
  "google_not_connected",
  "not_connected",
  "invalid_connection",
  "event_delete_forbidden",
  "event_delete_unauthorized",
  "user_not_linked",
  "not_project_member",
  "person_not_found",
  "permission_denied",
]);

export function planGoogleCalendarSyncWorkerOperations(
  reasons: readonly string[]
): GoogleCalendarSyncWorkerOperation[] {
  const normalizedReasons = new Set(
    reasons.map((reason) => reason.trim()).filter(Boolean)
  );
  if (normalizedReasons.size === 0
    || normalizedReasons.has("manual_retry")) {
    return [...FULL_SYNC_OPERATIONS];
  }

  const knownReasons = new Set([
    ...RECONCILE_REASONS,
    "rehearsal_updated",
    "rehearsal_deleted",
    "google_reconnected",
  ]);
  if ([...normalizedReasons].some((reason) => !knownReasons.has(reason))) {
    return [...FULL_SYNC_OPERATIONS];
  }

  const operations = new Set<GoogleCalendarSyncWorkerOperation>();
  if (normalizedReasons.has("rehearsal_deleted")
    || normalizedReasons.has("google_reconnected")) {
    operations.add("delete");
  }
  if ([...normalizedReasons].some((reason) => RECONCILE_REASONS.has(reason))
    || normalizedReasons.has("rehearsal_updated")
    || normalizedReasons.has("google_reconnected")) {
    operations.add("reconcile");
  }
  if (normalizedReasons.has("rehearsal_updated")
    || normalizedReasons.has("google_reconnected")) {
    operations.add("update");
  }
  return FULL_SYNC_OPERATIONS.filter((operation) => operations.has(operation));
}

export function summarizeGoogleCalendarSyncWorkerOperation(
  result: GoogleCalendarSyncWorkerOperationResult
): GoogleCalendarSyncExecutionResult {
  if (result.success && result.errorCodes.length === 0) {
    return { success: true, retryable: false, errorCode: null };
  }
  const failures = result.errorCodes.length > 0
    ? result.errorCodes.map(classifyGoogleCalendarSyncError)
    : [classifyGoogleCalendarSyncError("sync_operation_failed")];
  return summarizeGoogleCalendarSyncResults(failures);
}

function shouldStopAfterFailure(
  result: Exclude<GoogleCalendarSyncExecutionResult, { success: true }>
): boolean {
  return STOP_AFTER_ERROR_CODES.has(result.errorCode);
}

export async function executeGoogleCalendarSyncWorker(
  dependencies: GoogleCalendarSyncWorkerDependencies
): Promise<GoogleCalendarSyncWorkerResult> {
  const claim = await dependencies.claim();
  if (claim.kind !== "acquired") {
    return { kind: "not_claimed", claimKind: claim.kind, operations: [] };
  }

  const completedOperations: GoogleCalendarSyncWorkerOperation[] = [];
  const results: GoogleCalendarSyncExecutionResult[] = [];
  const operations = planGoogleCalendarSyncWorkerOperations(claim.reasons);
  let connection: GoogleCalendarSyncExecutionResult;
  try {
    connection = await dependencies.checkConnection();
  } catch (error) {
    connection = dependencies.classifyError(error);
  }
  results.push(connection);

  if (connection.success) {
    let identityChecked = false;
    let identityResult: GoogleCalendarSyncExecutionResult | null = null;
    for (const operation of operations) {
      if (operation !== "delete" && !identityChecked) {
        identityChecked = true;
        try {
          identityResult = await dependencies.checkIdentity();
        } catch (error) {
          identityResult = dependencies.classifyError(error);
        }
        results.push(identityResult);
      }
      if (operation !== "delete" && identityResult && !identityResult.success) {
        break;
      }

      let result: GoogleCalendarSyncExecutionResult;
      try {
        result = summarizeGoogleCalendarSyncWorkerOperation(
          await dependencies.runOperation(operation)
        );
      } catch (error) {
        result = dependencies.classifyError(error);
      }
      completedOperations.push(operation);
      results.push(result);
      if (!result.success && shouldStopAfterFailure(result)) break;
    }
  }

  const summary = summarizeGoogleCalendarSyncResults(results);
  if (summary.success) {
    const completion = await dependencies.complete({
      operationId: claim.operationId,
      claimedGeneration: claim.claimedGeneration,
    });
    if (completion === "rejected") {
      return { kind: "lease_lost", operations: completedOperations };
    }
    return { kind: "completed", completion, operations: completedOperations };
  }

  const jobStatus = await dependencies.fail({
    operationId: claim.operationId,
    claimedGeneration: claim.claimedGeneration,
    result: summary,
  });
  return {
    kind: "failed",
    jobStatus,
    errorCode: summary.errorCode,
    operations: completedOperations,
  };
}
