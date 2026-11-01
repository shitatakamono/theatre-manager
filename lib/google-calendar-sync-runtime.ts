export type GoogleCalendarRuntimeJob = {
  uid: string;
  projectId: string;
  status: string;
  generation: number;
  nextAttemptAtMillis: number | null;
};

export type GoogleCalendarRuntimeWorkerResult = {
  kind: string;
};

export type GoogleCalendarRetryBatchResult = {
  selectedCount: number;
  processedCount: number;
  failedCount: number;
  errorCodes: string[];
};

function finiteInteger(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

export function shouldRunGoogleCalendarPendingJob(
  before: Pick<GoogleCalendarRuntimeJob, "status" | "generation"> | null,
  after: Pick<GoogleCalendarRuntimeJob, "status" | "generation"> | null
): boolean {
  if (!after || after.status !== "pending") return false;
  if (!before || before.status !== "pending") return true;
  const beforeGeneration = finiteInteger(before.generation);
  const afterGeneration = finiteInteger(after.generation);
  return beforeGeneration !== null
    && afterGeneration !== null
    && beforeGeneration !== afterGeneration;
}

export function isGoogleCalendarRetryJobDue(
  job: Pick<GoogleCalendarRuntimeJob, "status" | "nextAttemptAtMillis">,
  nowMillis: number
): boolean {
  return job.status === "retry"
    && typeof job.nextAttemptAtMillis === "number"
    && Number.isFinite(job.nextAttemptAtMillis)
    && job.nextAttemptAtMillis <= nowMillis;
}

export async function runGoogleCalendarPendingJobIfNeeded(input: {
  before: Pick<GoogleCalendarRuntimeJob, "status" | "generation"> | null;
  after: GoogleCalendarRuntimeJob | null;
  runWorker: (job: Pick<GoogleCalendarRuntimeJob, "uid" | "projectId">) =>
    Promise<GoogleCalendarRuntimeWorkerResult>;
}): Promise<boolean> {
  if (!input.after
    || !shouldRunGoogleCalendarPendingJob(input.before, input.after)) {
    return false;
  }
  await input.runWorker({
    uid: input.after.uid,
    projectId: input.after.projectId,
  });
  return true;
}

export async function runGoogleCalendarRetryJobsSequentially(input: {
  jobs: readonly GoogleCalendarRuntimeJob[];
  nowMillis: number;
  limit: number;
  runWorker: (job: Pick<GoogleCalendarRuntimeJob, "uid" | "projectId">) =>
    Promise<GoogleCalendarRuntimeWorkerResult>;
}): Promise<GoogleCalendarRetryBatchResult> {
  const limit = Math.max(0, Math.trunc(input.limit));
  const jobs = input.jobs
    .filter((job) => isGoogleCalendarRetryJobDue(job, input.nowMillis))
    .slice(0, limit);
  let processedCount = 0;
  let failedCount = 0;

  for (const job of jobs) {
    try {
      await input.runWorker({ uid: job.uid, projectId: job.projectId });
      processedCount += 1;
    } catch {
      failedCount += 1;
    }
  }

  return {
    selectedCount: jobs.length,
    processedCount,
    failedCount,
    errorCodes: failedCount > 0 ? ["sync_worker_invocation_failed"] : [],
  };
}
