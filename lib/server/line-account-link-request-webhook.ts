import type { LineWebhookContext } from "../line-webhook.ts";
import { isLineUserLinked } from "./line-account-link.ts";
import {
  issueLineAccountLinkToken,
  replyLineAccountLinkGuide,
  replyLineAlreadyLinked,
} from "./line-messaging.ts";

type Dependencies = {
  isLinked: typeof isLineUserLinked;
  issueLinkToken: (lineUserId: string) => Promise<string>;
  replyGuide: (input: { replyToken: string; accountLinkPageUrl: string }) => Promise<void>;
  replyAlreadyLinked: (replyToken: string) => Promise<void>;
  appOrigin: string;
};

export type LineAccountLinkRequestResult = {
  requestedCount: number;
  guideReplyCount: number;
  alreadyLinkedReplyCount: number;
};

export function createLineAccountLinkPageUrl(appOrigin: string, linkToken: string): string {
  const url = new URL("/line/account-link", appOrigin);
  url.searchParams.set("linkToken", linkToken);
  return url.toString();
}

export function createLineAccountLinkRequestDependencies(input: {
  accessToken: string | undefined;
  appOrigin: string;
}): Dependencies {
  return {
    isLinked: isLineUserLinked,
    issueLinkToken: (lineUserId) => issueLineAccountLinkToken({
      lineUserId,
      accessToken: input.accessToken,
    }),
    replyGuide: ({ replyToken, accountLinkPageUrl }) => replyLineAccountLinkGuide({
      replyToken,
      accountLinkPageUrl,
      accessToken: input.accessToken,
    }),
    replyAlreadyLinked: (replyToken) => replyLineAlreadyLinked({
      replyToken,
      accessToken: input.accessToken,
    }),
    appOrigin: input.appOrigin,
  };
}

export async function processLineAccountLinkRequestWebhook(
  context: LineWebhookContext,
  dependencies: Dependencies
): Promise<LineAccountLinkRequestResult> {
  const result: LineAccountLinkRequestResult = {
    requestedCount: context.accountLinkRequestEvents.length,
    guideReplyCount: 0,
    alreadyLinkedReplyCount: 0,
  };

  for (const event of context.accountLinkRequestEvents) {
    if (await dependencies.isLinked(event.lineUserId)) {
      await dependencies.replyAlreadyLinked(event.replyToken);
      result.alreadyLinkedReplyCount += 1;
      continue;
    }

    const linkToken = await dependencies.issueLinkToken(event.lineUserId);
    const accountLinkPageUrl = createLineAccountLinkPageUrl(
      dependencies.appOrigin,
      linkToken
    );
    await dependencies.replyGuide({
      replyToken: event.replyToken,
      accountLinkPageUrl,
    });
    result.guideReplyCount += 1;
  }

  return result;
}
