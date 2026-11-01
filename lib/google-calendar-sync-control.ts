export const GOOGLE_CALENDAR_SYNC_STATUSES = [
  "pending",
  "running",
  "retry",
  "succeeded",
  "failed",
  "waiting_connection",
] as const;

export type SafeGoogleCalendarSyncStatus = {
  connected: boolean;
  syncStatus: typeof GOOGLE_CALENDAR_SYNC_STATUSES[number] | "not_started";
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  retryNeeded: boolean;
  nextAttemptAt: string | null;
};

type SafeJobInput = Omit<SafeGoogleCalendarSyncStatus, "connected" | "syncStatus"> & {
  status: string;
};

export function buildSafeGoogleCalendarSyncStatus(input: {
  connected: boolean;
  job: SafeJobInput | null;
}): SafeGoogleCalendarSyncStatus {
  const status = input.job && GOOGLE_CALENDAR_SYNC_STATUSES.includes(
    input.job.status as typeof GOOGLE_CALENDAR_SYNC_STATUSES[number]
  )
    ? input.job.status as typeof GOOGLE_CALENDAR_SYNC_STATUSES[number]
    : "not_started";
  return {
    connected: input.connected,
    syncStatus: status,
    lastSuccessAt: input.job?.lastSuccessAt ?? null,
    lastAttemptAt: input.job?.lastAttemptAt ?? null,
    lastErrorCode: input.job?.lastErrorCode ?? null,
    retryNeeded: input.job?.retryNeeded ?? false,
    nextAttemptAt: input.job?.nextAttemptAt ?? null,
  };
}

export type GoogleCalendarSyncControlDependencies = {
  verifyIdToken(token: string): Promise<{ uid: string }>;
  isProjectMember(uid: string, projectId: string): Promise<boolean>;
  getStatus(uid: string, projectId: string): Promise<SafeGoogleCalendarSyncStatus>;
  enqueueManualRetry(input: {
    uid: string;
    projectId: string;
    reason: "manual_retry";
  }): Promise<unknown>;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function projectIdFrom(value: unknown): string | null {
  const projectId = typeof value === "string" ? value.trim() : "";
  return projectId && projectId.length <= 128 && !projectId.includes("/")
    ? projectId
    : null;
}

async function authenticatedUid(
  request: Request,
  dependencies: GoogleCalendarSyncControlDependencies
): Promise<string | Response> {
  const match = (request.headers.get("authorization") ?? "")
    .match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "ログインが必要です", code: "unauthenticated" }, 401);
  try {
    return (await dependencies.verifyIdToken(match[1])).uid;
  } catch {
    return json(
      { error: "認証情報を確認できませんでした", code: "invalid_authentication" },
      401
    );
  }
}

export async function handleGoogleCalendarSyncStatusRequest(
  request: Request,
  dependencies: GoogleCalendarSyncControlDependencies
): Promise<Response> {
  const uid = await authenticatedUid(request, dependencies);
  if (uid instanceof Response) return uid;
  const projectId = projectIdFrom(new URL(request.url).searchParams.get("projectId"));
  if (!projectId) {
    return json({ error: "公演情報を確認してください", code: "invalid_project_id" }, 400);
  }
  if (!await dependencies.isProjectMember(uid, projectId)) {
    return json({ error: "この公演の同期状態を確認できません", code: "not_member" }, 403);
  }
  try {
    return json(await dependencies.getStatus(uid, projectId), 200);
  } catch {
    return json({ error: "同期状態を確認できませんでした", code: "sync_status_failed" }, 500);
  }
}

export async function handleGoogleCalendarResyncRequest(
  request: Request,
  dependencies: GoogleCalendarSyncControlDependencies
): Promise<Response> {
  const uid = await authenticatedUid(request, dependencies);
  if (uid instanceof Response) return uid;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "公演情報を確認してください", code: "invalid_request" }, 400);
  }
  const projectId = projectIdFrom(
    body && typeof body === "object" && "projectId" in body
      ? body.projectId
      : null
  );
  if (!projectId) {
    return json({ error: "公演情報を確認してください", code: "invalid_project_id" }, 400);
  }
  if (!await dependencies.isProjectMember(uid, projectId)) {
    return json({ error: "この公演を再同期できません", code: "not_member" }, 403);
  }
  try {
    await dependencies.enqueueManualRetry({ uid, projectId, reason: "manual_retry" });
    return json({ success: true, enqueued: true }, 202);
  } catch {
    return json({ error: "再同期を開始できませんでした", code: "resync_enqueue_failed" }, 500);
  }
}
