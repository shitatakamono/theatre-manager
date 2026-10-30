import "server-only";

import { Timestamp } from "firebase-admin/firestore";

import {
  buildGoogleCalendarEventDraft,
  buildGoogleCalendarInitialSyncPlan,
  buildGoogleCalendarMappingSource,
  summarizeGoogleCalendarInitialSync,
  type GoogleCalendarInitialSyncOutcome,
} from "@/lib/google-calendar-initial-sync";
import {
  getRehearsalTypeLabel,
  REHEARSAL_TYPE_OPTIONS,
} from "@/lib/rehearsals";
import { getGoogleCalendarAccessToken } from "@/lib/server/google-calendar-access-token";
import { ensureGoogleCalendar } from "@/lib/server/google-calendar-calendar";
import {
  claimGoogleCalendarEventLease,
  completeGoogleCalendarEventLease,
  getGoogleCalendarEventMapping,
  releaseGoogleCalendarEventLease,
} from "@/lib/server/google-calendar-event-mappings";
import { getGoogleCalendarSyncContext } from "@/lib/server/google-calendar-sync-preview";

const GOOGLE_CALENDARS_URL = "https://www.googleapis.com/calendar/v3/calendars";

export type GoogleCalendarInitialSyncErrorCode = "person_not_linked";

export class GoogleCalendarInitialSyncError extends Error {
  readonly code: GoogleCalendarInitialSyncErrorCode;
  readonly status: number;

  constructor(code: GoogleCalendarInitialSyncErrorCode, status: number) {
    super(code);
    this.name = "GoogleCalendarInitialSyncError";
    this.code = code;
    this.status = status;
  }
}

export type GoogleCalendarInitialSyncResult = {
  success: boolean;
  totalTargets: number;
  createdCount: number;
  skippedCount: number;
  failedCount: number;
  errorCodes: string[];
};

function categoryLabel(type: string, customType: string): string {
  const option = REHEARSAL_TYPE_OPTIONS.find(({ value }) => value === type);
  return option
    ? getRehearsalTypeLabel(option.value, customType)
    : customType.trim() || type;
}

async function createGoogleEvent(
  accessToken: string,
  calendarId: string,
  event: ReturnType<typeof buildGoogleCalendarEventDraft>
): Promise<{ eventId: string } | { error: string; status: number | null }> {
  if (!event) return { error: "missing_end_at", status: null };

  let response: Response;
  try {
    response = await fetch(
      `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      }
    );
  } catch {
    return { error: "event_creation_failed", status: null };
  }

  if (!response.ok) {
    return { error: "event_creation_failed", status: response.status };
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { error: "event_response_invalid", status: response.status };
  }

  const eventId = data && typeof data === "object" && "id" in data
    && typeof data.id === "string"
    ? data.id.trim()
    : "";
  return eventId
    ? { eventId }
    : { error: "event_response_invalid", status: response.status };
}

async function cleanupGoogleEvent(
  accessToken: string,
  calendarId: string,
  eventId: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `${GOOGLE_CALENDARS_URL}/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    return response.ok || response.status === 404 || response.status === 410;
  } catch {
    return false;
  }
}

function logItemFailure(code: string, status: number | null): void {
  console.error("google_calendar_initial_sync_item_failed", { code, status });
}

async function releaseEventLeaseSafely(
  uid: string,
  projectId: string,
  rehearsalId: string,
  operationId: string
): Promise<void> {
  try {
    await releaseGoogleCalendarEventLease(
      uid,
      projectId,
      rehearsalId,
      operationId
    );
  } catch {
    logItemFailure("event_lease_release_failed", null);
  }
}

export async function runGoogleCalendarInitialSync(
  uid: string,
  projectId: string
): Promise<GoogleCalendarInitialSyncResult> {
  const context = await getGoogleCalendarSyncContext(uid, projectId);
  if (!context.linked) {
    throw new GoogleCalendarInitialSyncError("person_not_linked", 409);
  }

  // This also verifies connected=true and the encrypted refresh token before any event work.
  const accessToken = await getGoogleCalendarAccessToken(uid);
  const mappings = await Promise.all(context.rehearsals.map((rehearsal) =>
    getGoogleCalendarEventMapping(uid, projectId, rehearsal.rehearsalId)
  ));
  const mappedRehearsalIds = new Set(
    mappings.flatMap((mapping) => mapping ? [mapping.rehearsalId] : [])
  );
  const plan = buildGoogleCalendarInitialSyncPlan(
    context.rehearsals,
    mappedRehearsalIds
  );

  if (plan.createTargets.length === 0) {
    return {
      success: true,
      totalTargets: plan.totalTargets,
      createdCount: 0,
      skippedCount: plan.skippedCount,
      failedCount: 0,
      errorCodes: [],
    };
  }

  const { calendarId } = await ensureGoogleCalendar(uid, accessToken);
  const outcomes: GoogleCalendarInitialSyncOutcome[] = [];
  let concurrentSkippedCount = 0;

  for (const rehearsal of plan.createTargets) {
    const draft = buildGoogleCalendarEventDraft({
      projectId,
      projectName: context.projectName,
      categoryLabel: categoryLabel(rehearsal.type, rehearsal.customType),
      rehearsal,
    });
    if (!draft) {
      logItemFailure("missing_end_at", null);
      outcomes.push({ status: "failed", code: "missing_end_at" });
      continue;
    }

    let lease: Awaited<ReturnType<typeof claimGoogleCalendarEventLease>>;
    try {
      lease = await claimGoogleCalendarEventLease(
        uid,
        projectId,
        rehearsal.rehearsalId
      );
    } catch {
      logItemFailure("event_lease_claim_failed", null);
      outcomes.push({ status: "failed", code: "event_lease_claim_failed" });
      continue;
    }
    if (lease.kind !== "acquired") {
      concurrentSkippedCount += 1;
      continue;
    }

    const created = await createGoogleEvent(accessToken, calendarId, draft);

    if ("error" in created) {
      await releaseEventLeaseSafely(
        uid,
        projectId,
        rehearsal.rehearsalId,
        lease.operationId
      );
      logItemFailure(created.error, created.status);
      outcomes.push({ status: "failed", code: created.error });
      continue;
    }

    const source = buildGoogleCalendarMappingSource(rehearsal);
    try {
      const completed = await completeGoogleCalendarEventLease(
        uid,
        lease.operationId,
        {
        projectId,
        rehearsalId: rehearsal.rehearsalId,
        calendarId,
        googleEventId: created.eventId,
        sourceRevision: source.sourceRevision,
        sourceHash: source.sourceHash,
        lastSyncedAt: Timestamp.now(),
        lastErrorCode: null,
        }
      );
      if (!completed) {
        const cleanedUp = await cleanupGoogleEvent(
          accessToken,
          calendarId,
          created.eventId
        );
        const code = cleanedUp
          ? "event_lease_lost"
          : "event_lease_lost_cleanup_failed";
        logItemFailure(code, null);
        outcomes.push({ status: "failed", code });
        continue;
      }
      outcomes.push({ status: "created" });
    } catch {
      const cleanedUp = await cleanupGoogleEvent(
        accessToken,
        calendarId,
        created.eventId
      );
      await releaseEventLeaseSafely(
        uid,
        projectId,
        rehearsal.rehearsalId,
        lease.operationId
      );
      const code = cleanedUp
        ? "mapping_save_failed"
        : "mapping_save_cleanup_failed";
      logItemFailure(code, null);
      outcomes.push({ status: "failed", code });
    }
  }

  const summary = summarizeGoogleCalendarInitialSync(outcomes);
  return {
    success: summary.failedCount === 0,
    totalTargets: plan.totalTargets,
    createdCount: summary.createdCount,
    skippedCount: plan.skippedCount + concurrentSkippedCount,
    failedCount: summary.failedCount,
    errorCodes: summary.errorCodes,
  };
}
