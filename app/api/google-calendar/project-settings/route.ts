import type { RehearsalType } from "@/lib/rehearsals";
import { adminAuth, adminDb } from "@/lib/server/firebase-admin";
import {
  handleGoogleCalendarSyncPreferencesGet,
  handleGoogleCalendarSyncPreferencesPatch,
} from "@/lib/server/google-calendar-sync-preferences-handler";
import {
  getGoogleCalendarProjectSyncPreference,
  saveGoogleCalendarProjectSyncPreference,
} from "@/lib/server/google-calendar-sync-preferences";
import { getGoogleCalendarSyncContext } from "@/lib/server/google-calendar-sync-preview";
import { enqueueGoogleCalendarProjectSync } from "@/lib/server/google-calendar-sync-jobs";

export const runtime = "nodejs";

const dependencies = {
  verifyIdToken: (token: string) => adminAuth.verifyIdToken(token),
  isProjectMember: async (uid: string, projectId: string) => (
    await adminDb.collection("projects").doc(projectId).collection("members").doc(uid).get()
  ).exists,
  getView: async (uid: string, projectId: string) => {
    const [preference, context, connection] = await Promise.all([
      getGoogleCalendarProjectSyncPreference(uid, projectId),
      getGoogleCalendarSyncContext(uid, projectId),
      adminDb.collection("googleCalendarConnections").doc(uid).get(),
    ]);
    return {
      configured: preference !== null,
      connected: connection.data()?.connected === true,
      rehearsalTypes: context.selectedTypes,
    };
  },
  save: async (uid: string, projectId: string, rehearsalTypes: RehearsalType[]) => {
    await saveGoogleCalendarProjectSyncPreference(uid, projectId, rehearsalTypes);
  },
  enqueue: enqueueGoogleCalendarProjectSync,
};

export function GET(request: Request): Promise<Response> {
  return handleGoogleCalendarSyncPreferencesGet(request, dependencies);
}

export function PATCH(request: Request): Promise<Response> {
  return handleGoogleCalendarSyncPreferencesPatch(request, dependencies);
}
