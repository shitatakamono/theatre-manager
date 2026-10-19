import { createMemberInviteEmailPostHandler } from "@/lib/server/member-invite-email-handler";

export const runtime = "nodejs";

export const POST = createMemberInviteEmailPostHandler({
  loadAuthModule: async () => {
    const { initializeInviteEmailFirebaseAdminAuth } = await import(
      "@/lib/server/member-invite-email-service"
    );
    return { initializeFirebaseAdminAuth: initializeInviteEmailFirebaseAdminAuth };
  },
  sendPendingInviteEmail: async (input) => {
    const { sendPendingInviteEmail } = await import("@/lib/server/member-invite-email-service");
    return sendPendingInviteEmail(input);
  },
});
