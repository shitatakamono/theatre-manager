import { getLineLoginRedirectUri } from "@/lib/app-url";
import {
  completeLineLoginState,
  failLineLoginState,
  readLineLoginState,
} from "@/lib/server/line-login";
import {
  exchangeLineLoginCode,
  getLineFriendshipStatus,
  verifyLineLoginIdToken,
} from "@/lib/server/line-login-client";
import { createLineLoginCallbackHandler } from "@/lib/server/line-login-handler";

export const runtime = "nodejs";

export const GET = createLineLoginCallbackHandler({
  readState: readLineLoginState,
  failState: failLineLoginState,
  exchangeCode: exchangeLineLoginCode,
  verifyIdToken: verifyLineLoginIdToken,
  getFriendshipStatus: getLineFriendshipStatus,
  completeState: completeLineLoginState,
  getConfig: () => {
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID?.trim() ?? "";
    const channelSecret = process.env.LINE_LOGIN_CHANNEL_SECRET?.trim() ?? "";
    if (!channelId || !channelSecret) throw new Error("missing LINE Login configuration");
    const redirectUri = getLineLoginRedirectUri();
    return {
      appOrigin: new URL(redirectUri).origin,
      channelId,
      channelSecret,
      redirectUri,
    };
  },
});
