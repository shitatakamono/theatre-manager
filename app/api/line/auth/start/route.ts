import { getLineAuthRedirectUri } from "@/lib/app-url";
import { createLineAuthState } from "@/lib/server/line-auth";
import { createLineAuthStartHandler } from "@/lib/server/line-auth-handler";

export const runtime = "nodejs";

export const POST = createLineAuthStartHandler({
  createState: createLineAuthState,
  getConfig: () => ({
    channelId: process.env.LINE_LOGIN_CHANNEL_ID?.trim() ?? "",
    redirectUri: getLineAuthRedirectUri(),
  }),
});
