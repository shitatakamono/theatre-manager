import { completeLineInviteSignup } from "@/lib/server/line-invite-signup";
import { createLineInviteSignupHandler } from "@/lib/server/line-invite-signup-handler";

export const runtime = "nodejs";
export const POST = createLineInviteSignupHandler({ complete: completeLineInviteSignup });
