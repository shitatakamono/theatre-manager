import { getApps, initializeApp } from "firebase-admin/app";
import { logger } from "firebase-functions";
import { setGlobalOptions } from "firebase-functions/v2";
import {
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentUpdated,
  onDocumentWritten,
} from "firebase-functions/v2/firestore";

import {
  didProjectCastStaffEligibilityChange,
  enqueueGoogleCalendarSyncForUids,
  planGoogleCalendarLinkedUserTrigger,
  planGoogleCalendarPersonTriggers,
  planGoogleCalendarRehearsalTrigger,
  type GoogleCalendarTriggerAudience,
} from "../../lib/google-calendar-sync-triggers";
import {
  getGoogleCalendarMappingOwnersForProject,
  getGoogleCalendarSyncUsersForProject,
} from "../../lib/server/google-calendar-sync-audience";
import {
  enqueueGoogleCalendarProjectSync,
} from "../../lib/server/google-calendar-sync-jobs";

if (getApps().length === 0) initializeApp();

// Firestore is in nam5. us-central1 is the closest supported Functions region.
setGlobalOptions({ region: "us-central1" });

const PROJECT_DOCUMENT = "projects/{projectId}";
const REHEARSAL_DOCUMENT = `${PROJECT_DOCUMENT}/rehearsals/{rehearsalId}`;
const PERSON_DOCUMENT = `${PROJECT_DOCUMENT}/people/{personId}`;
const LINKED_USER_DOCUMENT = `${PROJECT_DOCUMENT}/participantLinkedUsers/{uid}`;

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
