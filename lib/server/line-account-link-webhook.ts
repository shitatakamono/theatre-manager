import { LineAccountLinkError, type LineDeliveryEvent } from "../line-account-link.ts";
import type { LineWebhookContext } from "../line-webhook.ts";
import {
  failLineAccountLinkNonce,
  linkLineAccountFromWebhook,
  updateLineDeliveryStatus,
} from "./line-account-link.ts";

type LineAccountLinkWebhookDependencies = {
  linkAccount: typeof linkLineAccountFromWebhook;
  failNonce: typeof failLineAccountLinkNonce;
  updateDelivery: typeof updateLineDeliveryStatus;
};

const defaultDependencies: LineAccountLinkWebhookDependencies = {
  linkAccount: linkLineAccountFromWebhook,
  failNonce: failLineAccountLinkNonce,
  updateDelivery: updateLineDeliveryStatus,
};

export type LineAccountLinkWebhookResult = {
  linkedCount: number;
  idempotentCount: number;
  failedNonceCount: number;
  ignoredBusinessErrorCount: number;
  deliveryUpdatedCount: number;
};

async function updateDeliveries(
  event: LineDeliveryEvent,
  lineUserIds: readonly string[],
  dependencies: LineAccountLinkWebhookDependencies
): Promise<number> {
  let updated = 0;
  for (const lineUserId of lineUserIds) {
    const result = await dependencies.updateDelivery({ lineUserId, event });
    if (result.outcome === "updated") updated += 1;
  }
  return updated;
}

export async function processLineAccountLinkWebhook(
  context: LineWebhookContext,
  dependencies: LineAccountLinkWebhookDependencies = defaultDependencies
): Promise<LineAccountLinkWebhookResult> {
  const result: LineAccountLinkWebhookResult = {
    linkedCount: 0,
    idempotentCount: 0,
    failedNonceCount: 0,
    ignoredBusinessErrorCount: 0,
    deliveryUpdatedCount: 0,
  };

  for (const event of context.accountLinkEvents) {
    try {
      if (event.result === "failed") {
        const failure = await dependencies.failNonce(event.nonce);
        if (failure.outcome === "failed" || failure.outcome === "already_failed") {
          result.failedNonceCount += 1;
        }
        continue;
      }
      const linked = await dependencies.linkAccount({
        lineUserId: event.lineUserId,
        nonce: event.nonce,
      });
      if (linked.outcome === "linked") result.linkedCount += 1;
      else result.idempotentCount += 1;
    } catch (error) {
      if (error instanceof LineAccountLinkError) {
        result.ignoredBusinessErrorCount += 1;
        continue;
      }
      throw error;
    }
  }

  result.deliveryUpdatedCount += await updateDeliveries(
    "follow",
    context.followUserIds,
    dependencies
  );
  result.deliveryUpdatedCount += await updateDeliveries(
    "unfollow",
    context.unfollowUserIds,
    dependencies
  );
  return result;
}
