import { getLineLoginRedirectUri } from "@/lib/app-url";
import { adminAuth } from "@/lib/server/firebase-admin";
import { createLineLoginState, getLineLoginConnectionStatus } from "@/lib/server/line-login";
import { createLineLoginStartHandler } from "@/lib/server/line-login-handler";

export const runtime = "nodejs";

export const POST = createLineLoginStartHandler({
  verifyIdToken: (token) => adminAuth.verifyIdToken(token),
  getStatus: getLineLoginConnectionStatus,
  createState: createLineLoginState,
  getConfig: () => ({
    channelId: process.env.LINE_LOGIN_CHANNEL_ID?.trim() ?? "",
    redirectUri: getLineLoginRedirectUri(),
  }),
});
