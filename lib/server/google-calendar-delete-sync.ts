import "server-only";

import {
  classifyGoogleCalendarDeleteResponse,
  deleteGoogleCalendarMappedEvent,
  runGoogleCalendarDeleteSyncFlow,
  summarizeGoogleCalendarDeleteSync,
  type GoogleCalendarDeleteProviderResult,
  type GoogleCalendarDeleteSyncOutcome,
} from "@/lib/google-calendar-delete-sync";
import { getGoogleCalendarAccessToken } from "@/lib/server/google-calendar-access-token";
import {
  claimGoogleCalendarEventDeleteLease,
  completeGoogleCalendarEventDeleteLease,
  failGoogleCalendarEventDeleteLease,
  getGoogleCalendarEventMappingsForProject,
  type GoogleCalendarEventMapping,
} from "@/lib/server/google-calendar-event-mappings";
import { adminDb } from "@/lib/server/firebase-admin";

const GOOGLE_CALENDARS_URL = "https://www.googleapis.com/calendar/v3/calendars";

export type GoogleCalendarDeleteSyncResult = {
  success: boolean;
  mappedCount: number;
  existingRehearsalCount: number;
  deleteTargetCount: number;
  deletedCount: number;
  alreadyMissingCount: number;
  failedCount: number;
  errorCodes: string[];
};

export type GoogleCalendarDeleteTargetsResult = {
  deletedCount: number;
  alreadyMissingCount: number;
  failedCount: number;
  errorCodes: string[];
};

export type GoogleCalendarDeleteSyncContext = {
  mappings: GoogleCalendarEventMapping[];
  existingRehearsalIds: Set<string>;
};

export class GoogleCalendarDeleteSyncError extends Error {
  readonly code: "calendar_not_provisioned";
  readonly status = 409;

  constructor() {
    super("calendar_not_provisioned");
    this.name = "GoogleCalendarDeleteSyncError";
    this.code = "calendar_not_provisioned";
  }
}

async function getStoredCalendarId(uid: string): Promise<string> {
  const snapshot = await adminDb.collection("googleCalendarConnections").doc(uid).get();
  const calendarId = typeof snapshot.data()?.calendarId === "string"
    ? snapshot.data()?.calendarId.trim()
    : "";
  if (!snapshot.exists || snapshot.data()?.connected !== true || !calendarId) {
    throw new GoogleCalendarDeleteSyncError();
  }
  return calendarId;
}

async function deleteGoogleEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
}): Promise<GoogleCalendarDeleteProviderResult> {
  try {
    const response = await fetch(
      `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${input.accessToken}` },
      }
    );
    return classifyGoogleCalendarDeleteResponse(response.status);
  } catch {
    return classifyGoogleCalendarDeleteResponse(null);
  }
}

function logItemFailure(code: string, status: number | null): void {
  console.error("google_calendar_delete_sync_item_failed", { code, status });
}

async function failDeleteLeaseSafely(input: {
  uid: string;
  projectId: string;
  rehearsalId: string;
  operationId: string;
  errorCode: string;
}): Promise<void> {
  try {
    await failGoogleCalendarEventDeleteLease(
      input.uid,
      input.projectId,
      input.rehearsalId,
      input.operationId,
      input.errorCode
    );
  } catch {
    logItemFailure("event_delete_lease_release_failed", null);
  }
}

export async function runGoogleCalendarDeleteForMappings(input: {
  uid: string;
  projectId: string;
  mappings: readonly GoogleCalendarEventMapping[];
  accessToken: string;
  dedicatedCalendarId: string;
}): Promise<GoogleCalendarDeleteTargetsResult> {
  const outcomes: GoogleCalendarDeleteSyncOutcome[] = [];

  for (const target of input.mappings) {
    let lease: Awaited<ReturnType<typeof claimGoogleCalendarEventDeleteLease>>;
    try {
      lease = await claimGoogleCalendarEventDeleteLease(
        input.uid,
        input.projectId,
        target.rehearsalId
      );
    } catch {
      logItemFailure("event_delete_lease_claim_failed", null);
      outcomes.push({ status: "failed", code: "event_delete_lease_claim_failed" });
      continue;
    }

    if (lease.kind === "missing") {
      outcomes.push({ status: "already_missing" });
      continue;
    }
    if (lease.kind === "in_progress") {
      outcomes.push({ status: "failed", code: "event_delete_in_progress" });
      continue;
    }

    if (lease.mapping.calendarId !== input.dedicatedCalendarId) {
      await failDeleteLeaseSafely({
        uid: input.uid,
        projectId: input.projectId,
        rehearsalId: target.rehearsalId,
        operationId: lease.operationId,
        errorCode: "calendar_mismatch",
      });
      outcomes.push({ status: "failed", code: "calendar_mismatch" });
      continue;
    }

    let providerStatus: number | null = null;
    const outcome = await deleteGoogleCalendarMappedEvent({
      deleteGoogleEvent: async () => {
        const result = await deleteGoogleEvent({
          accessToken: input.accessToken,
          calendarId: lease.mapping.calendarId,
          eventId: lease.mapping.googleEventId,
        });
        providerStatus = result.providerStatus;
        return result;
      },
      deleteMapping: () => completeGoogleCalendarEventDeleteLease(
        input.uid,
        input.projectId,
        target.rehearsalId,
        lease.operationId
      ),
    });

    if (outcome.status === "failed") {
      if (outcome.code !== "event_delete_lease_lost") {
        await failDeleteLeaseSafely({
          uid: input.uid,
          projectId: input.projectId,
          rehearsalId: target.rehearsalId,
          operationId: lease.operationId,
          errorCode: outcome.code,
        });
      }
      logItemFailure(outcome.code, providerStatus);
    }
    outcomes.push(outcome);
  }

  return summarizeGoogleCalendarDeleteSync(outcomes);
}

export async function loadGoogleCalendarDeleteSyncContext(
  uid: string,
  projectId: string
): Promise<GoogleCalendarDeleteSyncContext> {
  const projectRef = adminDb.collection("projects").doc(projectId);
  const [rehearsalSnapshot, mappings] = await Promise.all([
    projectRef.collection("rehearsals").get(),
    getGoogleCalendarEventMappingsForProject(uid, projectId),
  ]);
  return {
    mappings,
    existingRehearsalIds: new Set(
      rehearsalSnapshot.docs.map((document) => document.id)
    ),
  };
}

export async function runGoogleCalendarDeleteSync(
  uid: string,
  projectId: string
): Promise<GoogleCalendarDeleteSyncResult> {
  return runGoogleCalendarDeleteSyncFlow(uid, projectId, {
    loadContext: loadGoogleCalendarDeleteSyncContext,
    getAccessToken: getGoogleCalendarAccessToken,
    getDedicatedCalendarId: getStoredCalendarId,
    deleteMappings: runGoogleCalendarDeleteForMappings,
  });
}
