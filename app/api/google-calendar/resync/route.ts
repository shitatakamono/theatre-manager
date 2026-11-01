import {
  handleGoogleCalendarResyncRequest,
} from "@/lib/google-calendar-sync-control";
import { adminAuth } from "@/lib/server/firebase-admin";
import {
  getSafeGoogleCalendarSyncStatus,
  isGoogleCalendarProjectMember,
} from "@/lib/server/google-calendar-sync-control";
import {
  enqueueGoogleCalendarProjectSync,
} from "@/lib/server/google-calendar-sync-jobs";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleGoogleCalendarResyncRequest(request, {
    verifyIdToken: (token) => adminAuth.verifyIdToken(token),
    isProjectMember: isGoogleCalendarProjectMember,
    getStatus: getSafeGoogleCalendarSyncStatus,
    enqueueManualRetry: enqueueGoogleCalendarProjectSync,
  });
}
