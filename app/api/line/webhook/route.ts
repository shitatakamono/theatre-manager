import { createLineWebhookHandler } from "@/lib/server/line-webhook-handler";

export const runtime = "nodejs";

export const POST = createLineWebhookHandler({
  getChannelSecret: () => process.env.LINE_CHANNEL_SECRET,
});
