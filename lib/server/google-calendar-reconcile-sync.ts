import "server-only";

import {
  buildGoogleCalendarReconcileSyncPlan,
  runGoogleCalendarReconcileOperations,
} from "@/lib/google-calendar-reconcile-sync";
import { getGoogleCalendarAccessToken } from "@/lib/server/google-calendar-access-token";
import { ensureGoogleCalendar } from "@/lib/server/google-calendar-calendar";
import { runGoogleCalendarDeleteForMappings } from "@/lib/server/google-calendar-delete-sync";
import { getGoogleCalendarEventMappingsForProject } from "@/lib/server/google-calendar-event-mappings";
import { adminDb } from "@/lib/server/firebase-admin";
import { createGoogleCalendarEventsForTargets } from "@/lib/server/google-calendar-initial-sync";
import { getGoogleCalendarSyncContext } from "@/lib/server/google-calendar-sync-preview";

export type GoogleCalendarReconcileSyncResult = {
  success: boolean;
  totalRehearsals: number;
  desiredCount: number;
  mappedCount: number;
  createTargetCount: number;
  deleteTargetCount: number;
  createdCount: number;
  deletedCount: number;
  alreadyMissingCount: number;
  failedCount: number;
  errorCodes: string[];
};

export type GoogleCalendarReconcileSyncErrorCode =
  | "user_not_linked"
  | "calendar_not_provisioned";

export class GoogleCalendarReconcileSyncError extends Error {
  readonly code: GoogleCalendarReconcileSyncErrorCode;
  readonly status = 409;

  constructor(code: GoogleCalendarReconcileSyncErrorCode) {
    super(code);
    this.name = "GoogleCalendarReconcileSyncError";
    this.code = code;
  }
}

async function getStoredCalendarId(uid: string): Promise<string> {
  const snapshot = await adminDb.collection("googleCalendarConnections").doc(uid).get();
  const calendarId = typeof snapshot.data()?.calendarId === "string"
    ? snapshot.data()?.calendarId.trim()
    : "";
  if (!snapshot.exists || snapshot.data()?.connected !== true || !calendarId) {
    throw new GoogleCalendarReconcileSyncError("calendar_not_provisioned");
  }
  return calendarId;
}

export async function runGoogleCalendarReconcileSync(
  uid: string,
  projectId: string
): Promise<GoogleCalendarReconcileSyncResult> {
  const context = await getGoogleCalendarSyncContext(uid, projectId);
  if (!context.linked) {
    // A removed link is not sufficient authorization to delete every mapping.
    throw new GoogleCalendarReconcileSyncError("user_not_linked");
  }

  const mappings = await getGoogleCalendarEventMappingsForProject(uid, projectId);
  const plan = buildGoogleCalendarReconcileSyncPlan({
    projectId,
    allRehearsals: context.allRehearsals,
    desiredRehearsals: context.rehearsals,
    mappings,
  });

  if (plan.createTargets.length === 0 && plan.deleteTargets.length === 0) {
    return {
      success: true,
      totalRehearsals: plan.totalRehearsals,
      desiredCount: plan.desiredCount,
      mappedCount: plan.mappedCount,
      createTargetCount: 0,
      deleteTargetCount: 0,
      createdCount: 0,
      deletedCount: 0,
      alreadyMissingCount: 0,
      failedCount: 0,
      errorCodes: [],
    };
  }

  const accessToken = await getGoogleCalendarAccessToken(uid);
  const calendarId = plan.createTargets.length > 0
    ? (await ensureGoogleCalendar(uid, accessToken)).calendarId
    : await getStoredCalendarId(uid);

  const summary = await runGoogleCalendarReconcileOperations({
    create: async () => {
      const result = plan.createTargets.length > 0
        ? await createGoogleCalendarEventsForTargets({
          uid,
          projectId,
          projectName: context.projectName,
          rehearsals: plan.createTargets,
          accessToken,
          calendarId,
        })
        : { createdCount: 0, failedCount: 0, errorCodes: [] };
      return result;
    },
    delete: async () => {
      const result = plan.deleteTargets.length > 0
        ? await runGoogleCalendarDeleteForMappings({
          uid,
          projectId,
          mappings: plan.deleteTargets,
          accessToken,
          dedicatedCalendarId: calendarId,
        })
        : { deletedCount: 0, alreadyMissingCount: 0, failedCount: 0, errorCodes: [] };
      return result;
    },
  });
  return {
    success: summary.failedCount === 0,
    totalRehearsals: plan.totalRehearsals,
    desiredCount: plan.desiredCount,
    mappedCount: plan.mappedCount,
    createTargetCount: plan.createTargets.length,
    deleteTargetCount: plan.deleteTargets.length,
    ...summary,
  };
}
