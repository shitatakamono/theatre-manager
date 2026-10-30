import "server-only";

import { toGoogleCalendarCreateSyncResult } from "@/lib/google-calendar-create-sync";
import {
  runGoogleCalendarInitialSync,
  type GoogleCalendarInitialSyncResult,
} from "@/lib/server/google-calendar-initial-sync";

export async function runGoogleCalendarCreateSync(
  uid: string,
  projectId: string
) {
  const result: GoogleCalendarInitialSyncResult =
    await runGoogleCalendarInitialSync(uid, projectId);
  return toGoogleCalendarCreateSyncResult(result);
}
