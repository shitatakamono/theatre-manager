import { auth } from "./firebase";
import type { ProjectInviteLinkSummary } from "./project-invite-links";

export const PROJECT_INVITE_SESSION_KEY = "seisakuboard:project-invite-token";
export const PROJECT_INVITE_RETURN_KEY = "seisakuboard:project-invite-return";

type CreateResult = { invite: ProjectInviteLinkSummary; url: string };

async function authorizationHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error("ログインが必要です");
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "招待リンクを処理できませんでした");
  return body;
}

export async function listProjectInviteLinks(projectId: string): Promise<ProjectInviteLinkSummary[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/invite-links`, {
    headers: await authorizationHeader(), cache: "no-store",
  });
  return (await read<{ invites: ProjectInviteLinkSummary[] }>(response)).invites;
}

export async function createProjectInviteLink(projectId: string, personId?: string): Promise<CreateResult> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/invite-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authorizationHeader()) },
    body: JSON.stringify(personId ? { personId } : {}),
  });
  return read<CreateResult>(response);
}

export async function revokeProjectInviteLink(projectId: string, inviteId: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/invite-links`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...(await authorizationHeader()) },
    body: JSON.stringify({ inviteId }),
  });
  await read<{ success: true }>(response);
}

export function storeProjectInviteForAuthentication(rawToken: string): void {
  try {
    sessionStorage.setItem(PROJECT_INVITE_SESSION_KEY, rawToken);
    sessionStorage.setItem(PROJECT_INVITE_RETURN_KEY, "/invite");
  } catch {
    // The invite page keeps the in-memory value when session storage is unavailable.
  }
}

export function takeProjectInviteReturnPath(): string | null {
  try {
    const value = sessionStorage.getItem(PROJECT_INVITE_RETURN_KEY);
    if (value === "/invite") sessionStorage.removeItem(PROJECT_INVITE_RETURN_KEY);
    return value === "/invite" ? value : null;
  } catch {
    return null;
  }
}
