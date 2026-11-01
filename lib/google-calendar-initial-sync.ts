import {
  buildGoogleCalendarRehearsalSourceHash,
  type GoogleCalendarRehearsalSource,
} from "./google-calendar-event-mapping.ts";
import type { GoogleCalendarSyncSourceRehearsal } from "./google-calendar-sync-preview.ts";

export type GoogleCalendarInitialSyncPlan = {
  totalTargets: number;
  skippedCount: number;
  createTargets: GoogleCalendarSyncSourceRehearsal[];
};

export type GoogleCalendarInitialSyncOutcome =
  | { status: "created" }
  | { status: "failed"; code: string };

export type GoogleCalendarInitialSyncSummary = {
  createdCount: number;
  failedCount: number;
  errorCodes: string[];
};

export type GoogleCalendarEventFinalizationResult =
  | { completed: true }
  | { completed: false; code: string };

export type GoogleCalendarEventDraft = {
  summary: string;
  location: string;
  description: string;
  start: { dateTime: string; timeZone: "Asia/Tokyo" };
  end: { dateTime: string; timeZone: "Asia/Tokyo" };
  extendedProperties: {
    private: {
      managedBy: "SeisakuBoard";
      projectId: string;
      rehearsalId: string;
    };
  };
};

export function buildGoogleCalendarInitialSyncPlan(
  rehearsals: readonly GoogleCalendarSyncSourceRehearsal[],
  mappedRehearsalIds: ReadonlySet<string>
): GoogleCalendarInitialSyncPlan {
  const uniqueTargets = new Map<string, GoogleCalendarSyncSourceRehearsal>();
  for (const rehearsal of rehearsals) {
    if (!uniqueTargets.has(rehearsal.rehearsalId)) {
      uniqueTargets.set(rehearsal.rehearsalId, rehearsal);
    }
  }

  const targets = [...uniqueTargets.values()];
  const createTargets = targets.filter(
    ({ rehearsalId }) => !mappedRehearsalIds.has(rehearsalId)
  );

  return {
    totalTargets: targets.length,
    skippedCount: targets.length - createTargets.length,
    createTargets,
  };
}

export function summarizeGoogleCalendarInitialSync(
  outcomes: readonly GoogleCalendarInitialSyncOutcome[]
): GoogleCalendarInitialSyncSummary {
  const errorCodes = new Set<string>();
  let createdCount = 0;
  let failedCount = 0;

  for (const outcome of outcomes) {
    if (outcome.status === "created") {
      createdCount += 1;
    } else {
      failedCount += 1;
      errorCodes.add(outcome.code);
    }
  }

  return { createdCount, failedCount, errorCodes: [...errorCodes] };
}

export async function finalizeCreatedGoogleCalendarEvent(input: {
  completeMapping(): Promise<boolean>;
  cleanupEvent(): Promise<boolean>;
  releaseLease(): Promise<void>;
}): Promise<GoogleCalendarEventFinalizationResult> {
  try {
    const completed = await input.completeMapping();
    if (completed) return { completed: true };
    const cleanedUp = await input.cleanupEvent();
    return {
      completed: false,
      code: cleanedUp ? "event_lease_lost" : "event_lease_lost_cleanup_failed",
    };
  } catch {
    const cleanedUp = await input.cleanupEvent();
    await input.releaseLease();
    return {
      completed: false,
      code: cleanedUp ? "mapping_save_failed" : "mapping_save_cleanup_failed",
    };
  }
}

export function buildGoogleCalendarEventDraft(input: {
  projectId: string;
  projectName: string;
  categoryLabel: string;
  rehearsal: GoogleCalendarSyncSourceRehearsal;
}): GoogleCalendarEventDraft | null {
  if (!input.rehearsal.endAt) return null;

  const details = [
    `公演：${input.projectName}`,
    `稽古種別：${input.categoryLabel}`,
    input.rehearsal.content ? `内容：${input.rehearsal.content}` : "",
    input.rehearsal.note ? `備考：${input.rehearsal.note}` : "",
    "SeisakuBoardから自動登録",
  ].filter(Boolean);

  return {
    summary: `【${input.categoryLabel}】${input.projectName}`,
    location: input.rehearsal.venue,
    description: details.join("\n"),
    start: { dateTime: input.rehearsal.startAt, timeZone: "Asia/Tokyo" },
    end: { dateTime: input.rehearsal.endAt, timeZone: "Asia/Tokyo" },
    extendedProperties: {
      private: {
        managedBy: "SeisakuBoard",
        projectId: input.projectId,
        rehearsalId: input.rehearsal.rehearsalId,
      },
    },
  };
}

export function buildGoogleCalendarMappingSource(
  rehearsal: GoogleCalendarSyncSourceRehearsal
): { sourceRevision: number; sourceHash: string } {
  const source: GoogleCalendarRehearsalSource = {
    startAt: rehearsal.startAt,
    endAt: rehearsal.endAt,
    categoryId: rehearsal.type,
    customType: rehearsal.customType,
    venue: rehearsal.venue,
    content: rehearsal.content,
    note: rehearsal.note,
  };

  return {
    sourceRevision: rehearsal.revision,
    sourceHash: buildGoogleCalendarRehearsalSourceHash(source),
  };
}
