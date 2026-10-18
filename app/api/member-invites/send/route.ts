import { createMemberInviteEmailPostHandler } from "@/lib/server/member-invite-email-handler";

export const runtime = "nodejs";

export const POST = createMemberInviteEmailPostHandler({
  verifyIdToken: async (idToken) => {
    const { verifyInviteEmailIdToken } = await import("@/lib/server/member-invite-email-service");
    return verifyInviteEmailIdToken(idToken);
  },
  sendPendingInviteEmail: async (input) => {
    const { sendPendingInviteEmail } = await import("@/lib/server/member-invite-email-service");
    return sendPendingInviteEmail(input);
  },
});
