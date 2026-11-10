export const PROJECT_INVITE_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type ProjectInviteLinkStatus = "pending" | "claiming" | "claimed" | "revoked";
export type ProjectInviteLinkDisplayStatus = "pending" | "claimed" | "revoked" | "expired";

export type ProjectInviteLinkSummary = {
  id: string;
  status: ProjectInviteLinkDisplayStatus;
  role: "viewer";
  personId: string | null;
  personName: string | null;
  createdAt: string | null;
  expiresAt: string;
  claimedAt: string | null;
};

export function isValidProjectInviteLinkToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function getProjectInviteLinkExpiry(createdAtMs: number): Date {
  return new Date(createdAtMs + PROJECT_INVITE_LINK_TTL_MS);
}

export function getProjectInviteLinkDisplayStatus(input: {
  status: ProjectInviteLinkStatus;
  expiresAtMs: number;
  nowMs?: number;
}): ProjectInviteLinkDisplayStatus {
  if (input.status === "claimed") return "claimed";
  if (input.status === "revoked") return "revoked";
  if (input.expiresAtMs <= (input.nowMs ?? Date.now())) return "expired";
  return "pending";
}

export function buildProjectInviteLinkUrl(appOrigin: string, rawToken: string): string {
  if (!isValidProjectInviteLinkToken(rawToken)) throw new Error("invalid_invite_token");
  const url = new URL("/invite", appOrigin);
  url.hash = new URLSearchParams({ token: rawToken }).toString();
  return url.toString();
}
