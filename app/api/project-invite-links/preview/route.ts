import { createProjectInviteLinkPreviewHandler } from "@/lib/server/project-invite-link-handler";
import { previewProjectInviteLink } from "@/lib/server/project-invite-links";

export const runtime = "nodejs";
export const POST = createProjectInviteLinkPreviewHandler({ preview: previewProjectInviteLink });
