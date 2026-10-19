import type { ProjectMember, ProjectRole, UserProfile } from "./auth.ts";

export type InviteRole = Extract<ProjectRole, "editor" | "viewer">;
export type MemberInviteStatus = "pending" | "accepted" | "revoked";
export type InviteEmailStatus = "not_sent" | "sent" | "failed";

export type ProjectMemberInvite = {
  id: string;
  projectId: string;
  projectName: string;
  email: string;
  role: InviteRole;
  invitedByUid: string;
  invitedByName: string;
  status: MemberInviteStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
  acceptedAt?: unknown | null;
  emailStatus: InviteEmailStatus;
  emailSentAt: unknown | null;
  emailLastError: string | null;
  emailSendCount: number;
  emailLastAttemptAt: unknown | null;
};

export const MEMBER_NAME_FALLBACK = "名前未設定のユーザー";

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidInviteEmail(email: string): boolean {
  const normalized = normalizeInviteEmail(email);
  return normalized.length <= 254
    && !normalized.includes("/")
    && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalized);
}

export function getMemberDisplayName(profile: Pick<UserProfile, "displayName">): string {
  return profile.displayName?.trim() || MEMBER_NAME_FALLBACK;
}

export function isExistingMemberEmail(
  members: readonly ProjectMember[],
  email: string
): boolean {
  const normalized = normalizeInviteEmail(email);
  return members.some((member) => normalizeInviteEmail(member.email ?? "") === normalized);
}

export function buildMemberInvitePayload<TimestampValue>(input: {
  projectId: string;
  projectName: string;
  email: string;
  role: InviteRole;
  invitedBy: UserProfile;
}, timestamp: TimestampValue) {
  const email = normalizeInviteEmail(input.email);
  if (!isValidInviteEmail(email)) throw new Error("有効なメールアドレスを入力してください");
  if (input.role !== "editor" && input.role !== "viewer") throw new Error("招待できるRoleはEditorまたはViewerです");

  return {
    projectId: input.projectId,
    projectName: input.projectName.trim() || "名称未設定の公演",
    email,
    role: input.role,
    invitedByUid: input.invitedBy.uid,
    invitedByName: getMemberDisplayName(input.invitedBy),
    status: "pending" as const,
    createdAt: timestamp,
    updatedAt: timestamp,
    acceptedAt: null,
    emailStatus: "not_sent" as const,
    emailSentAt: null,
    emailLastError: null,
    emailSendCount: 0,
    emailLastAttemptAt: null,
  };
}
