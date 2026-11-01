import "server-only";

import { buildSafeGoogleCalendarSyncStatus } from "@/lib/google-calendar-sync-control";
import { adminDb } from "@/lib/server/firebase-admin";
import { getGoogleCalendarSyncJob } from "@/lib/server/google-calendar-sync-jobs";

function iso(value: { toDate(): Date } | null): string | null {
  return value ? value.toDate().toISOString() : null;
}

export async function isGoogleCalendarProjectMember(
  uid: string,
  projectId: string
): Promise<boolean> {
  const member = await adminDb
    .collection("projects")
    .doc(projectId)
    .collection("members")
    .doc(uid)
    .get();
  return member.exists;
}

export async function getSafeGoogleCalendarSyncStatus(
  uid: string,
  projectId: string
) {
  const [connection, job] = await Promise.all([
    adminDb.collection("googleCalendarConnections").doc(uid).get(),
    getGoogleCalendarSyncJob(uid, projectId),
  ]);
  return buildSafeGoogleCalendarSyncStatus({
    connected: connection.data()?.connected === true,
    job: job ? {
      status: job.status,
      lastSuccessAt: iso(job.lastSuccessAt),
      lastAttemptAt: iso(job.lastAttemptAt),
      lastErrorCode: job.lastErrorCode,
      retryNeeded: job.retryNeeded,
      nextAttemptAt: iso(job.nextAttemptAt),
    } : null,
  });
}
