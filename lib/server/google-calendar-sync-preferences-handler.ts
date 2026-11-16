import type { RehearsalType } from "../rehearsals.ts";
import { parseGoogleCalendarSyncTypes } from "../google-calendar-sync-preferences.ts";

export type GoogleCalendarSyncPreferencesHandlerDependencies = {
  verifyIdToken(token: string): Promise<{ uid: string }>;
  isProjectMember(uid: string, projectId: string): Promise<boolean>;
  getView(uid: string, projectId: string): Promise<{
    configured: boolean;
    connected: boolean;
    rehearsalTypes: RehearsalType[];
  }>;
  save(uid: string, projectId: string, rehearsalTypes: RehearsalType[]): Promise<void>;
  enqueue(input: { uid: string; projectId: string; reason: "sync_preferences_changed" }): Promise<unknown>;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function projectIdFrom(value: unknown): string | null {
  const projectId = typeof value === "string" ? value.trim() : "";
  return projectId && projectId.length <= 128 && !projectId.includes("/") ? projectId : null;
}

async function authenticatedUid(
  request: Request,
  dependencies: GoogleCalendarSyncPreferencesHandlerDependencies
): Promise<string | Response> {
  const match = (request.headers.get("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  if (!match) return json({ error: "ログインが必要です", code: "unauthenticated" }, 401);
  try {
    return (await dependencies.verifyIdToken(match[1])).uid;
  } catch {
    return json({ error: "認証情報を確認できませんでした", code: "invalid_authentication" }, 401);
  }
}

export async function handleGoogleCalendarSyncPreferencesGet(
  request: Request,
  dependencies: GoogleCalendarSyncPreferencesHandlerDependencies
): Promise<Response> {
  const uid = await authenticatedUid(request, dependencies);
  if (uid instanceof Response) return uid;
  const projectId = projectIdFrom(new URL(request.url).searchParams.get("projectId"));
  if (!projectId) return json({ error: "公演情報を確認してください", code: "invalid_project_id" }, 400);
  if (!await dependencies.isProjectMember(uid, projectId)) {
    return json({ error: "この公演の同期設定を確認できません", code: "not_member" }, 403);
  }
  try {
    return json({ success: true, ...(await dependencies.getView(uid, projectId)) }, 200);
  } catch {
    return json({ error: "同期設定を確認できませんでした", code: "settings_load_failed" }, 500);
  }
}

export async function handleGoogleCalendarSyncPreferencesPatch(
  request: Request,
  dependencies: GoogleCalendarSyncPreferencesHandlerDependencies
): Promise<Response> {
  const uid = await authenticatedUid(request, dependencies);
  if (uid instanceof Response) return uid;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "同期設定を確認してください", code: "invalid_request" }, 400);
  }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const projectId = projectIdFrom(record.projectId);
  if (!projectId) return json({ error: "公演情報を確認してください", code: "invalid_project_id" }, 400);
  let rehearsalTypes: RehearsalType[];
  try {
    rehearsalTypes = parseGoogleCalendarSyncTypes(record.rehearsalTypes);
  } catch {
    return json({ error: "同期する稽古を確認してください", code: "invalid_rehearsal_types" }, 400);
  }
  if (!await dependencies.isProjectMember(uid, projectId)) {
    return json({ error: "この公演の同期設定を変更できません", code: "not_member" }, 403);
  }
  try {
    await dependencies.save(uid, projectId, rehearsalTypes);
    await dependencies.enqueue({ uid, projectId, reason: "sync_preferences_changed" });
    return json({ success: true, configured: true, rehearsalTypes }, 200);
  } catch {
    return json({ error: "同期設定を保存できませんでした", code: "settings_save_failed" }, 500);
  }
}
