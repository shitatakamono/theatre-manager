import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import {
  buildGoogleCalendarEventDraft,
} from "@/lib/google-calendar-initial-sync";
import {
  buildGoogleCalendarUpdateSyncPlan,
  buildGoogleCalendarCompletedUpdate,
  googleEventUpdateErrorCode,
  summarizeGoogleCalendarUpdateSync,
  type GoogleCalendarUpdateSyncOutcome,
} from "@/lib/google-calendar-update-sync";
import { getGoogleCalendarAccessToken } from "@/lib/server/google-calendar-access-token";
import {
  claimGoogleCalendarEventUpdateLease,
  completeGoogleCalendarEventUpdateLease,
  failGoogleCalendarEventUpdateLease,
  getGoogleCalendarEventMappingsForProject,
} from "@/lib/server/google-calendar-event-mappings";
import { getGoogleCalendarEventCategoryLabel } from "@/lib/server/google-calendar-initial-sync";
import { loadGoogleCalendarProjectRehearsalContext } from "@/lib/server/google-calendar-sync-preview";
import { adminDb } from "@/lib/server/firebase-admin";

const GOOGLE_CALENDARS_URL = "https://www.googleapis.com/calendar/v3/calendars";

export type GoogleCalendarUpdateSyncResult = {
  success: boolean;
  mappedCount: number;
  unchangedCount: number;
  updatedCount: number;
  failedCount: number;
  errorCodes: string[];
};

export class GoogleCalendarUpdateSyncError extends Error {
  readonly code: "calendar_not_provisioned";
  readonly status = 409;

  constructor() {
    super("calendar_not_provisioned");
    this.name = "GoogleCalendarUpdateSyncError";
    this.code = "calendar_not_provisioned";
  }
}

async function getStoredCalendarId(uid: string): Promise<string> {
  const snapshot = await adminDb.collection("googleCalendarConnections").doc(uid).get();
  const calendarId = typeof snapshot.data()?.calendarId === "string"
    ? snapshot.data()?.calendarId.trim()
    : "";
  if (!snapshot.exists || snapshot.data()?.connected !== true || !calendarId) {
    throw new GoogleCalendarUpdateSyncError();
  }
  return calendarId;
}

async function updateGoogleEvent(input: {
  accessToken: string;
  calendarId: string;
  eventId: string;
  event: NonNullable<ReturnType<typeof buildGoogleCalendarEventDraft>>;
}): Promise<{ success: true } | { success: false; code: string; status: number | null }> {
  let response: Response;
  try {
    response = await fetch(
      `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(input.calendarId)}/events/${encodeURIComponent(input.eventId)}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input.event),
      }
    );
  } catch {
    return { success: false, code: "event_update_failed", status: null };
  }
  if (!response.ok) {
    return {
      success: false,
      code: googleEventUpdateErrorCode(response.status),
      status: response.status,
    };
  }
  return { success: true };
}

function logItemFailure(code: string, status: number | null): void {
  console.error("google_calendar_update_sync_item_failed", { code, status });
}

async function failLeaseSafely(input: {
  uid: string;
  projectId: string;
  rehearsalId: string;
  operationId: string;
  targetSourceHash: string;
  errorCode: string;
}): Promise<void> {
  try {
    await failGoogleCalendarEventUpdateLease(
      input.uid,
      input.projectId,
      input.rehearsalId,
      input.operationId,
      input.targetSourceHash,
      input.errorCode
    );
  } catch {
    logItemFailure("mapping_error_save_failed", null);
  }
}

export async function runGoogleCalendarUpdateSync(
  uid: string,
  projectId: string
): Promise<GoogleCalendarUpdateSyncResult> {
  const [context, mappings] = await Promise.all([
    loadGoogleCalendarProjectRehearsalContext(uid, projectId),
    getGoogleCalendarEventMappingsForProject(uid, projectId),
  ]);
  const plan = buildGoogleCalendarUpdateSyncPlan(mappings, context.rehearsals);
  if (plan.updateTargets.length === 0) {
    return {
      success: true,
      mappedCount: plan.mappedCount,
      unchangedCount: plan.unchangedCount,
      updatedCount: 0,
      failedCount: 0,
      errorCodes: [],
    };
  }

  const [accessToken, dedicatedCalendarId] = await Promise.all([
    getGoogleCalendarAccessToken(uid),
    getStoredCalendarId(uid),
  ]);
  const outcomes: GoogleCalendarUpdateSyncOutcome[] = [];

  for (const target of plan.updateTargets) {
    let lease: Awaited<ReturnType<typeof claimGoogleCalendarEventUpdateLease>>;
    try {
      lease = await claimGoogleCalendarEventUpdateLease(
        uid,
        projectId,
        target.rehearsal.rehearsalId,
        target.sourceHash
      );
    } catch {
      logItemFailure("event_update_lease_claim_failed", null);
      outcomes.push({ status: "failed", code: "event_update_lease_claim_failed" });
      continue;
    }

    if (lease.kind === "unchanged") {
      outcomes.push({ status: "unchanged" });
      continue;
    }
    if (lease.kind === "in_progress") {
      outcomes.push({ status: "failed", code: "event_update_in_progress" });
      continue;
    }
    if (lease.kind === "missing") {
      outcomes.push({ status: "failed", code: "event_mapping_missing" });
      continue;
    }

    const draft = buildGoogleCalendarEventDraft({
      projectId,
      projectName: context.projectName,
      categoryLabel: getGoogleCalendarEventCategoryLabel(
        target.rehearsal.type,
        target.rehearsal.customType
      ),
      rehearsal: target.rehearsal,
    });
    if (!draft) {
      await failLeaseSafely({
        uid,
        projectId,
        rehearsalId: target.rehearsal.rehearsalId,
        operationId: lease.operationId,
        targetSourceHash: target.sourceHash,
        errorCode: "missing_end_at",
      });
      outcomes.push({ status: "failed", code: "missing_end_at" });
      continue;
    }

    if (lease.mapping.calendarId !== dedicatedCalendarId) {
      await failLeaseSafely({
        uid,
        projectId,
        rehearsalId: target.rehearsal.rehearsalId,
        operationId: lease.operationId,
        targetSourceHash: target.sourceHash,
        errorCode: "calendar_mismatch",
      });
      outcomes.push({ status: "failed", code: "calendar_mismatch" });
      continue;
    }

    const updated = await updateGoogleEvent({
      accessToken,
      calendarId: lease.mapping.calendarId,
      eventId: lease.mapping.googleEventId,
      event: draft,
    });
    if (!updated.success) {
      await failLeaseSafely({
        uid,
        projectId,
        rehearsalId: target.rehearsal.rehearsalId,
        operationId: lease.operationId,
        targetSourceHash: target.sourceHash,
        errorCode: updated.code,
      });
      logItemFailure(updated.code, updated.status);
      outcomes.push({ status: "failed", code: updated.code });
      continue;
    }

    try {
      const completed = await completeGoogleCalendarEventUpdateLease(
        uid,
        projectId,
        target.rehearsal.rehearsalId,
        lease.operationId,
        buildGoogleCalendarCompletedUpdate({
          sourceRevision: target.sourceRevision,
          sourceHash: target.sourceHash,
          lastSyncedAt: Timestamp.now(),
        })
      );
      if (!completed) {
        logItemFailure("event_update_lease_lost", null);
        outcomes.push({ status: "failed", code: "event_update_lease_lost" });
        continue;
      }
      outcomes.push({ status: "updated" });
    } catch {
      await failLeaseSafely({
        uid,
        projectId,
        rehearsalId: target.rehearsal.rehearsalId,
        operationId: lease.operationId,
        targetSourceHash: target.sourceHash,
        errorCode: "mapping_update_failed",
      });
      logItemFailure("mapping_update_failed", null);
      outcomes.push({ status: "failed", code: "mapping_update_failed" });
    }
  }

  const summary = summarizeGoogleCalendarUpdateSync(outcomes);
  return {
    success: summary.failedCount === 0,
    mappedCount: plan.mappedCount,
    unchangedCount: plan.unchangedCount + summary.unchangedCount,
    updatedCount: summary.updatedCount,
    failedCount: summary.failedCount,
    errorCodes: summary.errorCodes,
  };
}
