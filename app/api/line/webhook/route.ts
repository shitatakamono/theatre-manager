import { createLineWebhookHandler } from "@/lib/server/line-webhook-handler";
import { captureLatestLineFollow } from "@/lib/line-webhook";
import { saveLatestLineFollowUser } from "@/lib/server/line-test-user";
import { processLineAccountLinkWebhook } from "@/lib/server/line-account-link-webhook";
import {
  createLineAccountLinkRequestDependencies,
  processLineAccountLinkRequestWebhook,
} from "@/lib/server/line-account-link-request-webhook";
import { getAppOrigin } from "@/lib/app-url";

export const runtime = "nodejs";

export const POST = createLineWebhookHandler({
  getChannelSecret: () => process.env.LINE_CHANNEL_SECRET,
  // Temporary capture used only to identify one recipient during push-message testing.
  onVerifiedWebhook: async (_summary, context) => {
    await processLineAccountLinkWebhook(context);
    await captureLatestLineFollow(context, saveLatestLineFollowUser);
    await processLineAccountLinkRequestWebhook(
      context,
      createLineAccountLinkRequestDependencies({
        accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
        appOrigin: getAppOrigin(),
      })
    );
  },
});
