import type { LineDeliveryEvent } from "../line-account-link.ts";
import type { LineWebhookContext } from "../line-webhook.ts";
import { updateLineDeliveryStatus } from "./line-account-link.ts";

type Dependencies = {
  updateDelivery: typeof updateLineDeliveryStatus;
};

const defaultDependencies: Dependencies = {
  updateDelivery: updateLineDeliveryStatus,
};

async function updateDeliveries(
  event: LineDeliveryEvent,
  lineUserIds: readonly string[],
  dependencies: Dependencies
): Promise<number> {
  let updated = 0;
  for (const lineUserId of lineUserIds) {
    const result = await dependencies.updateDelivery({ lineUserId, event });
    if (result.outcome === "updated") updated += 1;
  }
  return updated;
}

export async function processLineDeliveryWebhook(
  context: LineWebhookContext,
  dependencies: Dependencies = defaultDependencies
): Promise<{ deliveryUpdatedCount: number }> {
  const followUpdatedCount = await updateDeliveries(
    "follow",
    context.followUserIds,
    dependencies
  );
  const unfollowUpdatedCount = await updateDeliveries(
    "unfollow",
    context.unfollowUserIds,
    dependencies
  );
  return { deliveryUpdatedCount: followUpdatedCount + unfollowUpdatedCount };
}
