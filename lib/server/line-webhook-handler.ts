import {
  parseLineWebhook,
  verifyLineWebhookSignature,
  type LineWebhookContext,
  type LineWebhookSummary,
} from "../line-webhook.ts";

type LineWebhookDependencies = {
  getChannelSecret: () => string | undefined;
  onVerifiedWebhook?: (
    summary: LineWebhookSummary,
    context: LineWebhookContext
  ) => void | Promise<void>;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export function createLineWebhookHandler(dependencies: LineWebhookDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const signature = request.headers.get("x-line-signature");
    if (!signature) {
      return json({ error: "署名を確認できませんでした", code: "invalid_signature" }, 401);
    }

    const channelSecret = dependencies.getChannelSecret();
    if (!channelSecret) {
      console.error("line_webhook_configuration_missing");
      return json({ error: "Webhookを受信できませんでした", code: "webhook_unavailable" }, 500);
    }

    let rawBody: Uint8Array;
    try {
      rawBody = new Uint8Array(await request.arrayBuffer());
    } catch {
      return json({ error: "リクエスト本文を確認できませんでした", code: "invalid_body" }, 400);
    }

    if (!verifyLineWebhookSignature(rawBody, signature, channelSecret)) {
      return json({ error: "署名を確認できませんでした", code: "invalid_signature" }, 401);
    }

    const webhook = parseLineWebhook(rawBody);
    if (!webhook) {
      return json({ error: "リクエスト本文が不正です", code: "invalid_body" }, 400);
    }

    try {
      await dependencies.onVerifiedWebhook?.(webhook.summary, webhook.context);
    } catch {
      console.error("line_webhook_processing_failed");
      return json({ error: "Webhookを処理できませんでした", code: "webhook_processing_failed" }, 500);
    }

    return json({ success: true }, 200);
  };
}
