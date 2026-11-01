import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { setGlobalOptions } from "firebase-functions/v2";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";

import {
  didProjectCastStaffEligibilityChange,
  enqueueGoogleCalendarSyncForUids,
  planGoogleCalendarLinkedUserTrigger,
  planGoogleCalendarPersonTriggers,
  planGoogleCalendarRehearsalTrigger,
  type GoogleCalendarTriggerAudience,
} from "../../lib/google-calendar-sync-triggers";
import {
  runGoogleCalendarPendingJobIfNeeded,
  runGoogleCalendarRetryJobsSequentially,
  type GoogleCalendarRuntimeJob,
} from "../../lib/google-calendar-sync-runtime";
import { adminDb } from "../../lib/server/firebase-admin";
import {
  getGoogleCalendarMappingOwnersForProject,
  getGoogleCalendarSyncUsersForProject,
} from "../../lib/server/google-calendar-sync-audience";
import {
  enqueueGoogleCalendarProjectSync,
} from "../../lib/server/google-calendar-sync-jobs";
import {
  runGoogleCalendarProjectSyncJob,
} from "../../lib/server/google-calendar-sync-worker";

if (getApps().length === 0) initializeApp();

// Firestore is in nam5. us-central1 is the closest supported Functions region.
setGlobalOptions({ region: "us-central1" });

const PROJECT_DOCUMENT = "projects/{projectId}";
const REHEARSAL_DOCUMENT = `${PROJECT_DOCUMENT}/rehearsals/{rehearsalId}`;
const PERSON_DOCUMENT = `${PROJECT_DOCUMENT}/people/{personId}`;
const LINKED_USER_DOCUMENT = `${PROJECT_DOCUMENT}/participantLinkedUsers/{uid}`;
const SYNC_JOB_DOCUMENT = "googleCalendarSyncJobs/{jobId}";
const RETRY_JOB_LIMIT = 10;

function timestampMillis(value: unknown): number | null {
  return value instanceof Timestamp ? value.toMillis() : null;
}

function runtimeJob(data: FirebaseFirestore.DocumentData | undefined):
GoogleCalendarRuntimeJob | null {
  if (!data
    || typeof data.uid !== "string"
    || typeof data.projectId !== "string"
    || typeof data.status !== "string"
    || !Number.isInteger(data.generation)) {
    return null;
  }
  return {
    uid: data.uid,
    projectId: data.projectId,
    status: data.status,
    generation: data.generation,
    nextAttemptAtMillis: timestampMillis(data.nextAttemptAt),
  };
}

async function audienceUids(
  projectId: string,
  audience: GoogleCalendarTriggerAudience
): Promise<string[]> {
  if (audience === "mapping_owners") {
    return getGoogleCalendarMappingOwnersForProject(projectId);
  }
  return (await getGoogleCalendarSyncUsersForProject(projectId)).normalSyncUids;
}

async function enqueueForAudience(input: {
  projectId: string;
  audience: GoogleCalendarTriggerAudience;
  reason: string;
}): Promise<void> {
  const result = await enqueueGoogleCalendarSyncForUids({
    projectId: input.projectId,
    uids: await audienceUids(input.projectId, input.audience),
    reason: input.reason,
    enqueue: enqueueGoogleCalendarProjectSync,
  });
  if (result.failedCount > 0) {
    logger.error("google_calendar_sync_job_enqueue_failed", {
      requestedCount: result.requestedCount,
      enqueuedCount: result.enqueuedCount,
      failedCount: result.failedCount,
      errorCodes: result.errorCodes,
    });
    // Retrying the event is safe: deterministic jobs coalesce duplicate reasons.
    throw new Error("google_calendar_sync_job_enqueue_failed");
  }
}

async function enqueueNormalUidRequests(
  projectId: string,
  requests: Array<{ uid: string; reason: string }>
): Promise<void> {
  if (requests.length === 0) return;
  const normalUids = new Set(
    (await getGoogleCalendarSyncUsersForProject(projectId)).normalSyncUids
  );
  for (const reason of [...new Set(requests.map((request) => request.reason))].sort()) {
    await enqueueGoogleCalendarSyncForUids({
      projectId,
      uids: requests
        .filter((request) => request.reason === reason && normalUids.has(request.uid))
        .map((request) => request.uid),
      reason,
      enqueue: enqueueGoogleCalendarProjectSync,
    }).then((result) => {
      if (result.failedCount > 0) {
        logger.error("google_calendar_sync_job_enqueue_failed", {
          requestedCount: result.requestedCount,
          enqueuedCount: result.enqueuedCount,
          failedCount: result.failedCount,
          errorCodes: result.errorCodes,
        });
        throw new Error("google_calendar_sync_job_enqueue_failed");
      }
    });
  }
}

export const onRehearsalCreated = onDocumentCreated(
  { document: REHEARSAL_DOCUMENT, retry: true },
  async (event) => {
    const plan = planGoogleCalendarRehearsalTrigger("create");
    if (!plan) return;
    await enqueueForAudience({ projectId: event.params.projectId, ...plan });
  }
);

export const onRehearsalUpdated = onDocumentUpdated(
  { document: REHEARSAL_DOCUMENT, retry: true },
  async (event) => {
    const plan = planGoogleCalendarRehearsalTrigger(
      "update",
      event.data?.before.data(),
      event.data?.after.data()
    );
    if (!plan) return;
    await enqueueForAudience({ projectId: event.params.projectId, ...plan });
  }
);

export const onRehearsalDeleted = onDocumentDeleted(
  { document: REHEARSAL_DOCUMENT, retry: true },
  async (event) => {
    const plan = planGoogleCalendarRehearsalTrigger("delete");
    if (!plan) return;
    await enqueueForAudience({ projectId: event.params.projectId, ...plan });
  }
);

export const onPersonWritten = onDocumentWritten(
  { document: PERSON_DOCUMENT, retry: true },
  async (event) => {
    const requests = planGoogleCalendarPersonTriggers(
      event.data?.before.data(),
      event.data?.after.data()
    );
    await enqueueNormalUidRequests(event.params.projectId, requests);
  }
);

export const onParticipantLinkedUserWritten = onDocumentWritten(
  { document: LINKED_USER_DOCUMENT, retry: true },
  async (event) => {
    const requests = planGoogleCalendarLinkedUserTrigger({
      uid: event.params.uid,
      beforeParticipantId: event.data?.before.data()?.participantId,
      afterParticipantId: event.data?.after.data()?.participantId,
    });
    await enqueueNormalUidRequests(event.params.projectId, requests);
  }
);

export const onProjectUpdated = onDocumentUpdated(
  { document: PROJECT_DOCUMENT, retry: true },
  async (event) => {
    if (!didProjectCastStaffEligibilityChange(
      event.data?.before.data(),
      event.data?.after.data()
    )) return;
    await enqueueForAudience({
      projectId: event.params.projectId,
      audience: "normal",
      reason: "cast_staff_changed",
    });
  }
);

export const onGoogleCalendarSyncJobPending = onDocumentWritten(
  {
    document: SYNC_JOB_DOCUMENT,
    retry: true,
    timeoutSeconds: 240,
    memory: "256MiB",
  },
  async (event) => {
    const before = runtimeJob(event.data?.before.data());
    const after = runtimeJob(event.data?.after.data());
    await runGoogleCalendarPendingJobIfNeeded({
      before,
      after,
      // The worker owns claim/complete/fail. A duplicate delivery that cannot
      // claim the job is a normal successful invocation.
      runWorker: runGoogleCalendarProjectSyncJob,
    });
  }
);

export const retryGoogleCalendarSyncJobs = onSchedule(
  {
    schedule: "every 1 minutes",
    timeoutSeconds: 240,
    memory: "256MiB",
  },
  async () => {
    const now = Timestamp.now();
    const snapshot = await adminDb
      .collection("googleCalendarSyncJobs")
      .where("status", "==", "retry")
      .where("nextAttemptAt", "<=", now)
      .orderBy("nextAttemptAt", "asc")
      .limit(RETRY_JOB_LIMIT)
      .get();
    const jobs = snapshot.docs
      .map((document) => runtimeJob(document.data()))
      .filter((job): job is GoogleCalendarRuntimeJob => job !== null);
    const result = await runGoogleCalendarRetryJobsSequentially({
      jobs,
      nowMillis: now.toMillis(),
      limit: RETRY_JOB_LIMIT,
      runWorker: runGoogleCalendarProjectSyncJob,
    });
    if (result.failedCount > 0) {
      logger.error("google_calendar_retry_worker_invocation_failed", {
        selectedCount: result.selectedCount,
        processedCount: result.processedCount,
        failedCount: result.failedCount,
        errorCodes: result.errorCodes,
      });
    }
  }
);
