import "server-only";
import { Timestamp } from "firebase-admin/firestore";
import { Resend } from "resend";
import {
  deliverInviteEmail,
  InviteEmailRequestError,
  validateInviteEmailSend,
} from "../member-invite-email.ts";
import { normalizeInviteEmail, type InviteRole } from "../member-invites.ts";
import { adminAuth, adminDb } from "./firebase-admin";

type ReservedInvite = {
  email: string;
  projectName: string;
  role: InviteRole;
  invitedByName: string;
  invitePath: string;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new InviteEmailRequestError(500, "server_configuration", `${name}が設定されていません`);
  return value;
}

async function reserveInviteSend(input: {
  uid: string;
  projectId: string;
  inviteEmail: string;
  nowMs: number;
}): Promise<ReservedInvite> {
  const memberRef = adminDb.doc(`projects/${input.projectId}/members/${input.uid}`);
  const projectRef = adminDb.doc(`projects/${input.projectId}`);
  const normalizedEmail = normalizeInviteEmail(input.inviteEmail);
  const inviteRef = adminDb.doc(`projects/${input.projectId}/memberInvites/${normalizedEmail}`);

  return adminDb.runTransaction(async (transaction) => {
    const [memberSnapshot, projectSnapshot, inviteSnapshot] = await Promise.all([
      transaction.get(memberRef), transaction.get(projectRef), transaction.get(inviteRef),
    ]);
    const invite = inviteSnapshot.data() ?? {};
    const lastAttemptAtMs = invite.emailLastAttemptAt instanceof Timestamp
      ? invite.emailLastAttemptAt.toMillis()
      : null;
    const projectData = projectSnapshot.data();
    const hasConsistentMembership = Array.isArray(projectData?.memberUids)
      && projectData.memberUids.includes(input.uid);
    const rawMemberRole = memberSnapshot.data()?.role;
    const memberRole = hasConsistentMembership
      && (rawMemberRole === "owner" || rawMemberRole === "editor" || rawMemberRole === "viewer")
      ? rawMemberRole
      : null;
    const authorized = validateInviteEmailSend({
      memberRole,
      projectExists: projectSnapshot.exists,
      inviteExists: inviteSnapshot.exists,
      requestedEmail: normalizedEmail,
      storedEmail: invite.email,
      status: invite.status,
      role: invite.role,
      lastAttemptAtMs,
      nowMs: input.nowMs,
    });

    transaction.update(inviteRef, {
      emailLastAttemptAt: Timestamp.fromMillis(input.nowMs),
      emailSendCount: typeof invite.emailSendCount === "number" ? invite.emailSendCount + 1 : 1,
      updatedAt: Timestamp.fromMillis(input.nowMs),
    });
    return {
      email: authorized.email,
      projectName: (projectData?.title || invite.projectName || "名称未設定の公演") as string,
      role: authorized.role,
      invitedByName: (invite.invitedByName || "名前未設定のユーザー") as string,
      invitePath: inviteRef.path,
    };
  });
}

export async function verifyInviteEmailIdToken(idToken: string): Promise<{ uid: string }> {
  const decoded = await adminAuth.verifyIdToken(idToken);
  return { uid: decoded.uid };
}

export async function sendPendingInviteEmail(input: {
  uid: string;
  projectId: string;
  inviteEmail: string;
}): Promise<{ email: string }> {
  const nowMs = Date.now();
  const reserved = await reserveInviteSend({ ...input, nowMs });
  const inviteRef = adminDb.doc(reserved.invitePath);

  try {
    const resend = new Resend(requiredEnvironment("RESEND_API_KEY"));
    const replyTo = process.env.INVITE_EMAIL_REPLY_TO?.trim();
    await deliverInviteEmail(reserved, {
      from: requiredEnvironment("INVITE_EMAIL_FROM"),
      appUrl: requiredEnvironment("NEXT_PUBLIC_APP_URL"),
      ...(replyTo ? { replyTo } : {}),
    }, {
      send: async (message) => {
        const { error } = await resend.emails.send(message);
        if (error) throw new Error(error.message);
      },
      markSent: async () => {
        await inviteRef.update({
          emailStatus: "sent",
          emailSentAt: Timestamp.fromMillis(nowMs),
          emailLastError: null,
          updatedAt: Timestamp.fromMillis(nowMs),
        });
      },
      markFailed: async (failureCode) => {
        await inviteRef.update({
          emailStatus: "failed",
          emailLastError: failureCode,
          updatedAt: Timestamp.fromMillis(nowMs),
        });
      },
    });
    return { email: reserved.email };
  } catch (error) {
    if (error instanceof InviteEmailRequestError) {
      await inviteRef.update({
        emailStatus: "failed",
        emailLastError: "configuration_error",
        updatedAt: Timestamp.fromMillis(nowMs),
      });
      throw error;
    }
    throw new InviteEmailRequestError(
      502,
      "send_failed",
      "招待メールを送信できませんでした。時間をおいて再度お試しください"
    );
  }
}
