import { createMemberInviteEmailPostHandler } from "@/lib/server/member-invite-email-handler";
import { sendPendingInviteEmail, verifyInviteEmailIdToken } from "@/lib/server/member-invite-email-service";

export const runtime = "nodejs";

export const POST = createMemberInviteEmailPostHandler({
  verifyIdToken: verifyInviteEmailIdToken,
  sendPendingInviteEmail,
});
