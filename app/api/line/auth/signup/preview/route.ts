import { previewLineInviteSignup } from "@/lib/server/line-invite-signup";
import { createLineInviteSignupPreviewHandler } from "@/lib/server/line-invite-signup-handler";

export const runtime = "nodejs";
export const POST = createLineInviteSignupPreviewHandler({ preview: previewLineInviteSignup });
