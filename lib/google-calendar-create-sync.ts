export type GoogleCalendarCreationSyncResult = {
  success: boolean;
  totalTargets: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  errorCodes: string[];
};

export type GoogleCalendarCreateSyncResult = {
  success: boolean;
  targetCount: number;
  existingCount: number;
  createdCount: number;
  failedCount: number;
  errorCodes: string[];
};

export function toGoogleCalendarCreateSyncResult(
  result: GoogleCalendarCreationSyncResult
): GoogleCalendarCreateSyncResult {
  return {
    success: result.success,
    targetCount: result.totalTargets,
    existingCount: result.skippedCount,
    createdCount: result.createdCount,
    failedCount: result.failedCount,
    errorCodes: result.errorCodes,
  };
}
