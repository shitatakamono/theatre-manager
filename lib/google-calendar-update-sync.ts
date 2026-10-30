import type { GoogleCalendarEventMapping } from "./server/google-calendar-event-mappings.ts";
import {
  buildGoogleCalendarMappingSource,
} from "./google-calendar-initial-sync.ts";
import type { GoogleCalendarSyncSourceRehearsal } from "./google-calendar-sync-preview.ts";

export type GoogleCalendarUpdateTarget = {
  mapping: GoogleCalendarEventMapping;
  rehearsal: GoogleCalendarSyncSourceRehearsal;
  sourceRevision: number;
  sourceHash: string;
};

export type GoogleCalendarUpdateSyncPlan = {
  mappedCount: number;
  unchangedCount: number;
  updateTargets: GoogleCalendarUpdateTarget[];
};

export type GoogleCalendarUpdateSyncOutcome =
  | { status: "updated" }
  | { status: "unchanged" }
  | { status: "failed"; code: string };

export function buildGoogleCalendarUpdateSyncPlan(
  mappings: readonly GoogleCalendarEventMapping[],
  rehearsals: readonly GoogleCalendarSyncSourceRehearsal[]
): GoogleCalendarUpdateSyncPlan {
  const rehearsalsById = new Map(
    rehearsals.map((rehearsal) => [rehearsal.rehearsalId, rehearsal])
  );
  const updateTargets: GoogleCalendarUpdateTarget[] = [];
  let mappedCount = 0;
  let unchangedCount = 0;

  for (const mapping of mappings) {
    const rehearsal = rehearsalsById.get(mapping.rehearsalId);
    if (!rehearsal) continue;
    mappedCount += 1;
    const source = buildGoogleCalendarMappingSource(rehearsal);
    if (mapping.sourceHash === source.sourceHash) {
      unchangedCount += 1;
      continue;
    }
    updateTargets.push({ mapping, rehearsal, ...source });
  }

  return { mappedCount, unchangedCount, updateTargets };
}

export function summarizeGoogleCalendarUpdateSync(
  outcomes: readonly GoogleCalendarUpdateSyncOutcome[]
): { updatedCount: number; unchangedCount: number; failedCount: number; errorCodes: string[] } {
  let updatedCount = 0;
  let unchangedCount = 0;
  let failedCount = 0;
  const errorCodes = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.status === "updated") updatedCount += 1;
    else if (outcome.status === "unchanged") unchangedCount += 1;
    else {
      failedCount += 1;
      errorCodes.add(outcome.code);
    }
  }
  return { updatedCount, unchangedCount, failedCount, errorCodes: [...errorCodes] };
}

export function googleEventUpdateErrorCode(
  status: number | null
): "google_event_not_found" | "event_update_failed" {
  return status === 404 ? "google_event_not_found" : "event_update_failed";
}

export function buildGoogleCalendarCompletedUpdate<T>(input: {
  sourceRevision: number;
  sourceHash: string;
  lastSyncedAt: T;
}): {
  sourceRevision: number;
  sourceHash: string;
  lastSyncedAt: T;
  lastErrorCode: null;
} {
  return { ...input, lastErrorCode: null };
}
