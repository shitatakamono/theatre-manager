import type { InviteRole } from "./member-invites.ts";
import type { ProjectRole } from "./auth.ts";

export const INVITE_EMAIL_COOLDOWN_MS = 60_000;

export class InviteEmailRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string
  ) {
    super(message);
    this.name = "InviteEmailRequestError";
    this.status = status;
    this.code = code;
  }
}

export type InviteEmailContentInput = {
  projectName: string;
  role: InviteRole;
  invitedByName: string;
  appUrl: string;
};

export type ReservedInviteEmail = Omit<InviteEmailContentInput, "appUrl"> & {
  email: string;
};

export type InviteEmailProviderMessage = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
};

export const inviteRoleLabels: Record<InviteRole, string> = {
  editor: "編集者",
  viewer: "閲覧者",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export function normalizeAppUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("NEXT_PUBLIC_APP_URLはhttpまたはhttpsで指定してください");
  }
  return url.toString().replace(/\/$/, "");
}

export function buildInviteEmailContent(input: InviteEmailContentInput) {
  const appUrl = normalizeAppUrl(input.appUrl);
  const projectName = input.projectName.trim() || "名称未設定の公演";
  const invitedByName = input.invitedByName.trim() || "名前未設定のユーザー";
  const roleLabel = inviteRoleLabels[input.role];
  const subject = `【SeisakuBoard】${projectName}に招待されました`;
  const text = [
    "SeisakuBoardへの招待が届きました。",
    "",
    `公演: ${projectName}`,
    `権限: ${roleLabel}`,
    `招待した人: ${invitedByName}`,
    "",
    "このメールを受信したGoogleアカウントでログインしてください。",
    `SeisakuBoardを開く: ${appUrl}`,
    "",
    "この招待に心当たりがない場合は、このメールを無視してください。",
  ].join("\n");
  const safeProjectName = escapeHtml(projectName);
  const safeInvitedByName = escapeHtml(invitedByName);
  const safeRoleLabel = escapeHtml(roleLabel);
  const safeAppUrl = escapeHtml(appUrl);
  const html = `<!doctype html>
<html lang="ja"><body style="margin:0;background:#f4f7f5;color:#1f2937;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  <div style="background:#ffffff;border:1px solid #dfe7e2;border-radius:12px;padding:28px">
    <p style="margin:0 0 20px;color:#166534;font-size:13px;font-weight:700;letter-spacing:.08em">SEISAKU BOARD</p>
    <h1 style="margin:0 0 20px;font-size:22px">公演制作チームへの招待</h1>
    <p style="margin:0 0 18px;line-height:1.7">${safeInvitedByName}さんから、SeisakuBoardの公演へ招待されました。</p>
    <table style="width:100%;margin:0 0 24px;border-collapse:collapse;font-size:14px">
      <tr><th style="padding:8px 12px;text-align:left;background:#f4f7f5">公演</th><td style="padding:8px 12px">${safeProjectName}</td></tr>
      <tr><th style="padding:8px 12px;text-align:left;background:#f4f7f5">権限</th><td style="padding:8px 12px">${safeRoleLabel}</td></tr>
    </table>
    <p style="margin:0 0 20px;line-height:1.7">このメールを受信したGoogleアカウントでログインしてください。</p>
    <p style="margin:0 0 24px"><a href="${safeAppUrl}" style="display:inline-block;border-radius:8px;background:#166534;color:#fff;padding:12px 20px;text-decoration:none;font-weight:700">SeisakuBoardを開く</a></p>
    <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.7">この招待に心当たりがない場合は、このメールを無視してください。</p>
  </div>
</div></body></html>`;

  return { subject, text, html, appUrl };
}

export function isInviteEmailCooldownActive(
  lastAttemptAtMs: number | null,
  nowMs: number,
  cooldownMs = INVITE_EMAIL_COOLDOWN_MS
): boolean {
  return lastAttemptAtMs !== null && nowMs - lastAttemptAtMs < cooldownMs;
}

export function validateInviteEmailSend(input: {
  memberRole: ProjectRole | null;
  projectExists: boolean;
  inviteExists: boolean;
  requestedEmail: string;
  storedEmail?: unknown;
  status?: unknown;
  role?: unknown;
  lastAttemptAtMs: number | null;
  nowMs: number;
}): { email: string; role: InviteRole } {
  if (input.memberRole !== "owner") {
    throw new InviteEmailRequestError(403, "owner_required", "招待メールを送信できるのはOwnerのみです");
  }
  if (!input.projectExists || !input.inviteExists) {
    throw new InviteEmailRequestError(404, "invite_not_found", "招待が見つかりません");
  }
  if (input.status !== "pending") {
    throw new InviteEmailRequestError(409, "invite_not_pending", "招待中のメンバーにのみメールを送信できます");
  }
  const requestedEmail = input.requestedEmail.trim().toLowerCase();
  if (input.storedEmail !== requestedEmail || (input.role !== "editor" && input.role !== "viewer")) {
    throw new InviteEmailRequestError(409, "invalid_invite", "招待情報が不正です");
  }
  if (isInviteEmailCooldownActive(input.lastAttemptAtMs, input.nowMs)) {
    throw new InviteEmailRequestError(429, "send_too_soon", "再送は前回の送信操作から60秒後に行えます");
  }
  return { email: requestedEmail, role: input.role };
}

export async function deliverInviteEmail(
  invite: ReservedInviteEmail,
  config: { from: string; appUrl: string; replyTo?: string },
  dependencies: {
    send: (message: InviteEmailProviderMessage) => Promise<void>;
    markSent: () => Promise<void>;
    markFailed: (failureCode: string) => Promise<void>;
  }
): Promise<void> {
  try {
    const content = buildInviteEmailContent({
      projectName: invite.projectName,
      role: invite.role,
      invitedByName: invite.invitedByName,
      appUrl: config.appUrl,
    });
    await dependencies.send({
      from: config.from,
      to: [invite.email],
      subject: content.subject,
      html: content.html,
      text: content.text,
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    });
    await dependencies.markSent();
  } catch (error) {
    await dependencies.markFailed("provider_rejected");
    throw error;
  }
}
