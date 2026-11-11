import { getApps, initializeApp } from "firebase-admin/app";
import { Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";
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
import {
  retryDueLineRehearsalReminders,
  runTomorrowLineRehearsalReminders,
} from "../../lib/server/line-rehearsal-reminder";
import {
  recordRehearsalChangeNotificationEvent,
  retryRehearsalChangeNotifications,
  runRehearsalChangeNotifications,
} from "../../lib/server/line-rehearsal-change";

if (getApps().length === 0) initializeApp();

// Firestore is in nam5. us-central1 is the closest supported Functions region.
setGlobalOptions({ region: "us-central1" });

const PROJECT_DOCUMENT = "projects/{projectId}";
const REHEARSAL_DOCUMENT = `${PROJECT_DOCUMENT}/rehearsals/{rehearsalId}`;
const PERSON_DOCUMENT = `${PROJECT_DOCUMENT}/people/{personId}`;
const LINKED_USER_DOCUMENT = `${PROJECT_DOCUMENT}/participantLinkedUsers/{uid}`;
const SYNC_JOB_DOCUMENT = "googleCalendarSyncJobs/{jobId}";
const RETRY_JOB_LIMIT = 10;
const googleCalendarWorkerSecrets = [
  defineSecret("GOOGLE_CALENDAR_CLIENT_ID"),
  defineSecret("GOOGLE_CALENDAR_CLIENT_SECRET"),
  defineSecret("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY"),
];
const lineChannelAccessToken = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");

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
    await Promise.all([
      recordRehearsalChangeNotificationEvent({
        eventId: event.id,
        projectId: event.params.projectId,
        rehearsalId: event.params.rehearsalId,
        eventType: "created",
        after: event.data?.data(),
      }),
      plan ? enqueueForAudience({ projectId: event.params.projectId, ...plan }) : Promise.resolve(),
    ]);
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
    await Promise.all([
      recordRehearsalChangeNotificationEvent({
        eventId: event.id,
        projectId: event.params.projectId,
        rehearsalId: event.params.rehearsalId,
        eventType: "updated",
        before: event.data?.before.data(),
        after: event.data?.after.data(),
      }),
      plan ? enqueueForAudience({ projectId: event.params.projectId, ...plan }) : Promise.resolve(),
    ]);
  }
);

export const onRehearsalDeleted = onDocumentDeleted(
  { document: REHEARSAL_DOCUMENT, retry: true },
  async (event) => {
    const plan = planGoogleCalendarRehearsalTrigger("delete");
    await Promise.all([
      recordRehearsalChangeNotificationEvent({
        eventId: event.id,
        projectId: event.params.projectId,
        rehearsalId: event.params.rehearsalId,
        eventType: "deleted",
        before: event.data?.data(),
      }),
      plan ? enqueueForAudience({ projectId: event.params.projectId, ...plan }) : Promise.resolve(),
    ]);
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
    secrets: googleCalendarWorkerSecrets,
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
    secrets: googleCalendarWorkerSecrets,
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

export const sendTomorrowRehearsalLineReminders = onSchedule(
  {
    schedule: "0 12 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "256MiB",
    secrets: [lineChannelAccessToken],
  },
  async () => {
    const result = await runTomorrowLineRehearsalReminders();
    logger.info("line_rehearsal_reminder_completed", {
      projectCount: result.targetProjectCount,
      rehearsalCount: result.rehearsalCount,
      participantCount: result.participantCount,
      linkedCount: result.linkedCount,
      unlinkedCount: result.unlinkedCount,
      recipientCount: result.recipientCount,
      sentCount: result.sentCount,
      skippedCount: result.skippedCount,
      failedCount: result.failedCount,
    });
  }
);

export const retryRehearsalLineReminders = onSchedule(
  {
    schedule: "every 10 minutes",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "256MiB",
    secrets: [lineChannelAccessToken],
  },
  async () => {
    const results = await retryDueLineRehearsalReminders();
    logger.info("line_rehearsal_reminder_retry_completed", {
      batchCount: results.length,
      sentCount: results.reduce((sum, result) => sum + result.sentCount, 0),
      skippedCount: results.reduce((sum, result) => sum + result.skippedCount, 0),
      failedCount: results.reduce((sum, result) => sum + result.failedCount, 0),
    });
  }
);

async function runRehearsalChangeSchedule(slot: "12" | "20"): Promise<void> {
  const result = await runRehearsalChangeNotifications({ slot });
  logger.info("line_rehearsal_change_notification_completed", {
    eventCount: result.eventCount,
    projectCount: result.projectCount,
    batchCount: result.batchCount,
    rehearsalCount: result.rehearsalCount,
    noopCount: result.noopCount,
    recipientCount: result.recipientCount,
    sentCount: result.sentCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    retryCount: result.retryCount,
    suppressedCount: result.suppressedCount,
  });
}

export const sendNoonRehearsalChangeLineNotifications = onSchedule(
  {
    schedule: "0 12 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "256MiB",
    secrets: [lineChannelAccessToken],
  },
  async () => runRehearsalChangeSchedule("12")
);

export const sendEveningRehearsalChangeLineNotifications = onSchedule(
  {
    schedule: "0 20 * * *",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "256MiB",
    secrets: [lineChannelAccessToken],
  },
  async () => runRehearsalChangeSchedule("20")
);

export const retryRehearsalChangeLineNotifications = onSchedule(
  {
    schedule: "every 10 minutes",
    timeZone: "Asia/Tokyo",
    timeoutSeconds: 540,
    memory: "256MiB",
    secrets: [lineChannelAccessToken],
  },
  async () => {
    const result = await retryRehearsalChangeNotifications();
    logger.info("line_rehearsal_change_notification_retry_completed", {
      sentCount: result.sentCount,
      failedCount: result.failedCount,
      retryCount: result.retryCount,
    });
  }
);
