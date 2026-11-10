import { getLineAuthRedirectUri } from "@/lib/app-url";
import {
  completeLineAuthState,
  failLineAuthState,
  readLineAuthState,
} from "@/lib/server/line-auth";
import { createLineAuthCallbackHandler } from "@/lib/server/line-auth-handler";
import { exchangeLineLoginCode, verifyLineLoginIdToken } from "@/lib/server/line-login-client";

export const runtime = "nodejs";

export const GET = createLineAuthCallbackHandler({
  readState: readLineAuthState,
  failState: failLineAuthState,
  exchangeCode: exchangeLineLoginCode,
  verifyIdToken: verifyLineLoginIdToken,
  completeState: completeLineAuthState,
  getConfig: () => {
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim() ?? "";
    const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET?.trim() ?? "";
    if (!channelId || !channelSecret) throw new Error("missing LINE Login configuration");
    const redirectUri = getLineAuthRedirectUri();
    return {
      appOrigin: new URL(redirectUri).origin,
      channelId,
      channelSecret,
      redirectUri,
    };
  },
});
