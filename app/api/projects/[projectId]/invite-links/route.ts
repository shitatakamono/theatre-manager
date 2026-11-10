import { adminAuth } from "@/lib/server/firebase-admin";
import { createProjectInviteLinkManagementHandlers } from "@/lib/server/project-invite-link-handler";
import {
  createProjectInviteLink,
  listProjectInviteLinks,
  revokeProjectInviteLink,
} from "@/lib/server/project-invite-links";

export const runtime = "nodejs";

const handlers = createProjectInviteLinkManagementHandlers({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  list: listProjectInviteLinks,
  create: createProjectInviteLink,
  revoke: revokeProjectInviteLink,
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
