import { createLineWebhookHandler } from "@/lib/server/line-webhook-handler";
import { processLineDeliveryWebhook } from "@/lib/server/line-delivery-webhook";

export const runtime = "nodejs";

export const POST = createLineWebhookHandler({
  getChannelSecret: () => process.env.LINE_CHANNEL_SECRET,
  onVerifiedWebhook: async (_summary, context) => {
    await processLineDeliveryWebhook(context);
  },
});
