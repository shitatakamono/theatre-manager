import { adminAuth } from "@/lib/server/firebase-admin";
import { createProjectInviteLinkClaimHandler } from "@/lib/server/project-invite-link-handler";
import { claimProjectInviteLink } from "@/lib/server/project-invite-links";

export const runtime = "nodejs";
export const POST = createProjectInviteLinkClaimHandler({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  getUser: (uid) => adminAuth.getUser(uid),
  claim: claimProjectInviteLink,
});
