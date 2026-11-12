import { auth } from "./firebase";

export type LineLinkHistoryItem = {
  id: string;
  eventType: "linked" | "relinked" | "project_link_removed";
  personName: string;
  lineDisplayName: string;
  occurredAt: string;
};

async function authorizationHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error("ログインが必要です");
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

async function read<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "LINE連携情報を処理できませんでした");
  return body;
}

export async function listLineLinkHistory(projectId: string): Promise<LineLinkHistoryItem[]> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/line-link-events`, {
    headers: await authorizationHeader(), cache: "no-store",
  });
  return (await read<{ events: LineLinkHistoryItem[] }>(response)).events;
}

export async function repairLinePersonLink(projectId: string, personId: string): Promise<void> {
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/line-link-events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authorizationHeader()) },
    body: JSON.stringify({ personId }),
  });
  await read<{ success: true }>(response);
}
