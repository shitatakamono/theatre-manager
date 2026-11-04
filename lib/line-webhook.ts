import { createHmac, timingSafeEqual } from "node:crypto";

export type LineWebhookEventType =
  | "follow"
  | "unfollow"
  | "message"
  | "postback"
  | "unknown";

export type LineWebhookSummary = {
  eventCount: number;
  eventTypes: LineWebhookEventType[];
};

export function verifyLineWebhookSignature(
  rawBody: Uint8Array,
  signature: string,
  channelSecret: string
): boolean {
  if (!signature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");
  const expectedBytes = Buffer.from(expected, "utf8");
  const signatureBytes = Buffer.from(signature, "utf8");
  return expectedBytes.length === signatureBytes.length
    && timingSafeEqual(expectedBytes, signatureBytes);
}

export function parseLineWebhookSummary(rawBody: Uint8Array): LineWebhookSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || !("events" in parsed)) return null;
  const events = (parsed as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  const knownTypes = new Set<LineWebhookEventType>([
    "follow",
    "unfollow",
    "message",
    "postback",
  ]);
  return {
    eventCount: events.length,
    eventTypes: events.map((event) => {
      if (!event || typeof event !== "object") return "unknown";
      const type = (event as { type?: unknown }).type;
      return typeof type === "string" && knownTypes.has(type as LineWebhookEventType)
        ? type as LineWebhookEventType
        : "unknown";
    }),
  };
}
