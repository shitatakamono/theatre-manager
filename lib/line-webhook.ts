import { createHmac, timingSafeEqual } from "node:crypto";
import { isValidLineAccountLinkNonce } from "./line-account-link.ts";

export type LineWebhookEventType =
  | "follow"
  | "unfollow"
  | "message"
  | "postback"
  | "accountLink"
  | "unknown";

export type LineWebhookSummary = {
  eventCount: number;
  eventTypes: LineWebhookEventType[];
};

export type LineWebhookContext = {
  followUserIds: string[];
  unfollowUserIds: string[];
  accountLinkEvents: LineWebhookAccountLinkEvent[];
};

export type LineWebhookAccountLinkEvent =
  | { result: "ok"; lineUserId: string; nonce: string }
  | { result: "failed"; nonce: string };

type ParsedLineWebhook = {
  summary: LineWebhookSummary;
  context: LineWebhookContext;
};

const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/i;

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

export function parseLineWebhook(rawBody: Uint8Array): ParsedLineWebhook | null {
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
    "accountLink",
  ]);
  const eventTypes = events.map((event) => {
    if (!event || typeof event !== "object") return "unknown";
    const type = (event as { type?: unknown }).type;
    return typeof type === "string" && knownTypes.has(type as LineWebhookEventType)
      ? type as LineWebhookEventType
      : "unknown";
  });
  const userIdsForType = (eventType: "follow" | "unfollow") => events.flatMap((event) => {
    if (!event || typeof event !== "object" || (event as { type?: unknown }).type !== eventType) {
      return [];
    }
    const source = (event as { source?: unknown }).source;
    if (!source || typeof source !== "object") return [];
    const userId = (source as { userId?: unknown }).userId;
    return typeof userId === "string" && LINE_USER_ID_PATTERN.test(userId)
      ? [userId]
      : [];
  });
  const accountLinkEvents = events.flatMap((event): LineWebhookAccountLinkEvent[] => {
    if (!event || typeof event !== "object" || (event as { type?: unknown }).type !== "accountLink") {
      return [];
    }
    const link = (event as { link?: unknown }).link;
    if (!link || typeof link !== "object") return [];
    const result = (link as { result?: unknown }).result;
    const nonce = (link as { nonce?: unknown }).nonce;
    if (typeof nonce !== "string" || !isValidLineAccountLinkNonce(nonce)) return [];
    if (result === "failed") return [{ result, nonce }];
    if (result !== "ok") return [];
    const source = (event as { source?: unknown }).source;
    if (!source || typeof source !== "object") return [];
    const lineUserId = (source as { userId?: unknown }).userId;
    return typeof lineUserId === "string" && LINE_USER_ID_PATTERN.test(lineUserId)
      ? [{ result, lineUserId, nonce }]
      : [];
  });
  return {
    summary: {
      eventCount: events.length,
      eventTypes,
    },
    context: {
      followUserIds: userIdsForType("follow"),
      unfollowUserIds: userIdsForType("unfollow"),
      accountLinkEvents,
    },
  };
}

export function parseLineWebhookSummary(rawBody: Uint8Array): LineWebhookSummary | null {
  return parseLineWebhook(rawBody)?.summary ?? null;
}

export async function captureLatestLineFollow(
  context: LineWebhookContext,
  save: (lineUserId: string) => Promise<void>
): Promise<boolean> {
  const lineUserId = context.followUserIds.at(-1);
  if (!lineUserId) return false;
  await save(lineUserId);
  return true;
}
