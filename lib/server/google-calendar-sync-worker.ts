import "server-only";

import {
  classifyGoogleCalendarSyncError,
  type GoogleCalendarSyncExecutionResult,
} from "@/lib/google-calendar-sync-job";
import {
  executeGoogleCalendarSyncWorker,
  type GoogleCalendarSyncWorkerOperation,
  type GoogleCalendarSyncWorkerOperationResult,
  type GoogleCalendarSyncWorkerResult,
} from "@/lib/google-calendar-sync-worker";
import { adminDb } from "@/lib/server/firebase-admin";
import {
  isGoogleCalendarConnectionCredentialAvailable,
} from "@/lib/server/google-calendar-sync-audience";
import { runGoogleCalendarDeleteSync } from "@/lib/server/google-calendar-delete-sync";
import { runGoogleCalendarReconcileSync } from "@/lib/server/google-calendar-reconcile-sync";
import {
  claimGoogleCalendarSyncJob,
  completeGoogleCalendarSyncJob,
  failGoogleCalendarSyncJob,
} from "@/lib/server/google-calendar-sync-jobs";
import { runGoogleCalendarUpdateSync } from "@/lib/server/google-calendar-update-sync";

function successResult(): GoogleCalendarSyncExecutionResult {
  return { success: true, retryable: false, errorCode: null };
}

async function checkGoogleCalendarSyncWorkerConnection(
  uid: string
): Promise<GoogleCalendarSyncExecutionResult> {
  const connection = await adminDb
    .collection("googleCalendarConnections")
    .doc(uid)
    .get();
  const connectionData = connection.data();
  if (!connection.exists || connectionData?.connected !== true) {
    return classifyGoogleCalendarSyncError("google_not_connected");
  }
  if (!isGoogleCalendarConnectionCredentialAvailable(connectionData)) {
    return classifyGoogleCalendarSyncError("invalid_connection");
  }
  return successResult();
}

async function checkGoogleCalendarSyncWorkerIdentity(
  uid: string,
  projectId: string
): Promise<GoogleCalendarSyncExecutionResult> {
  const projectRef = adminDb.collection("projects").doc(projectId);
  const [member, linkedUser] = await adminDb.getAll(
    projectRef.collection("members").doc(uid),
    projectRef.collection("participantLinkedUsers").doc(uid)
  );
  if (!member.exists) {
    return classifyGoogleCalendarSyncError("not_project_member");
  }
  if (!linkedUser.exists) {
    return classifyGoogleCalendarSyncError("user_not_linked");
  }

  const participantId = typeof linkedUser.data()?.participantId === "string"
    ? linkedUser.data()?.participantId.trim()
    : "";
  if (!participantId || participantId.includes("/")) {
    return classifyGoogleCalendarSyncError("user_not_linked");
  }
  const person = await projectRef.collection("people").doc(participantId).get();
  if (!person.exists) {
    return classifyGoogleCalendarSyncError("person_not_found");
  }
  return successResult();
}

function safeErrorCode(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    && typeof error.code === "string"
    ? error.code
    : "sync_worker_failed";
  if (code === "not_connected") return "google_not_connected";
  if (code === "refresh_token_invalid"
    || code === "refresh_token_decryption_failed") {
    return "invalid_connection";
  }
  if (code === "not_member") return "not_project_member";
  if (code === "linked_person_not_found") return "person_not_found";
  return code;
}

function resultFromSyncHelper(result: {
  success: boolean;
  errorCodes: string[];
}): GoogleCalendarSyncWorkerOperationResult {
  return { success: result.success, errorCodes: result.errorCodes };
}

async function runOperation(
  operation: GoogleCalendarSyncWorkerOperation,
  uid: string,
  projectId: string
): Promise<GoogleCalendarSyncWorkerOperationResult> {
  if (operation === "delete") {
    return resultFromSyncHelper(await runGoogleCalendarDeleteSync(uid, projectId));
  }
  if (operation === "reconcile") {
    return resultFromSyncHelper(await runGoogleCalendarReconcileSync(uid, projectId));
  }
  return resultFromSyncHelper(await runGoogleCalendarUpdateSync(uid, projectId));
}

export async function runGoogleCalendarProjectSyncJob(input: {
  uid: string;
  projectId: string;
}): Promise<GoogleCalendarSyncWorkerResult> {
  return executeGoogleCalendarSyncWorker({
    claim: async () => {
      const claim = await claimGoogleCalendarSyncJob(input.uid, input.projectId);
      if (claim.kind !== "acquired") return claim;
      return {
        kind: "acquired",
        operationId: claim.operationId,
        claimedGeneration: claim.claimedGeneration,
        reasons: claim.job.reasons,
      };
    },
    checkConnection: () => checkGoogleCalendarSyncWorkerConnection(input.uid),
    checkIdentity: () => checkGoogleCalendarSyncWorkerIdentity(
      input.uid,
      input.projectId
    ),
    runOperation: (operation) => runOperation(
      operation,
      input.uid,
      input.projectId
    ),
    complete: ({ operationId, claimedGeneration }) =>
      completeGoogleCalendarSyncJob({
        ...input,
        operationId,
        claimedGeneration,
      }),
    fail: ({ operationId, claimedGeneration, result }) =>
      failGoogleCalendarSyncJob({
        ...input,
        operationId,
        claimedGeneration,
        result,
      }),
    classifyError: (error) =>
      classifyGoogleCalendarSyncError(safeErrorCode(error)),
  });
}
