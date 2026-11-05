import { requireLineLinkToken } from "../line-account-link-authorize.ts";

export const LINE_PUSH_MESSAGE_ENDPOINT = "https://api.line.me/v2/bot/message/push";
export const LINE_REPLY_MESSAGE_ENDPOINT = "https://api.line.me/v2/bot/message/reply";
export const LINE_LINK_TOKEN_ENDPOINT_BASE = "https://api.line.me/v2/bot/user";
export const LINE_TEST_MESSAGE_TEXT = "SeisakuBoardからのLINE連携テストです。";

export type LineMessagingErrorCode =
  | "line_access_token_missing"
  | "line_authentication_failed"
  | "line_rate_limited"
  | "line_request_rejected"
  | "line_server_error"
  | "line_network_error"
  | "line_invalid_response";

export class LineMessagingError extends Error {
  readonly code: LineMessagingErrorCode;
  readonly status: number;
  readonly lineStatus: number | null;

  constructor(
    code: LineMessagingErrorCode,
    status: number,
    lineStatus: number | null = null
  ) {
    super("LINEへのメッセージ送信に失敗しました");
    this.name = "LineMessagingError";
    this.code = code;
    this.status = status;
    this.lineStatus = lineStatus;
  }
}

async function lineRequest(input: {
  endpoint: string;
  accessToken: string | undefined;
  body?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<Response> {
  if (!input.accessToken) {
    throw new LineMessagingError("line_access_token_missing", 503);
  }

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(input.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new LineMessagingError("line_network_error", 502);
  }

  if (response.ok) return response;
  if (response.status === 401 || response.status === 403) {
    throw new LineMessagingError("line_authentication_failed", 502, response.status);
  }
  if (response.status === 429) {
    throw new LineMessagingError("line_rate_limited", 503, response.status);
  }
  if (response.status >= 500) {
    throw new LineMessagingError("line_server_error", 503, response.status);
  }
  throw new LineMessagingError("line_request_rejected", 502, response.status);
}

export async function issueLineAccountLinkToken(input: {
  lineUserId: string;
  accessToken: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const response = await lineRequest({
    endpoint: `${LINE_LINK_TOKEN_ENDPOINT_BASE}/${encodeURIComponent(input.lineUserId)}/linkToken`,
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl,
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new LineMessagingError("line_invalid_response", 502, response.status);
  }
  const linkToken = body && typeof body === "object"
    ? (body as { linkToken?: unknown }).linkToken
    : null;
  if (typeof linkToken !== "string") {
    throw new LineMessagingError("line_invalid_response", 502, response.status);
  }
  try {
    return requireLineLinkToken(linkToken);
  } catch {
    throw new LineMessagingError("line_invalid_response", 502, response.status);
  }
}

export async function replyLineAccountLinkGuide(input: {
  replyToken: string;
  accountLinkPageUrl: string;
  accessToken: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  await lineRequest({
    endpoint: LINE_REPLY_MESSAGE_ENDPOINT,
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl,
    body: {
      replyToken: input.replyToken,
      messages: [{
        type: "template",
        altText: "SeisakuBoardとLINEを連携します。ボタンからログインしてください。",
        template: {
          type: "buttons",
          text: "SeisakuBoardとLINEを連携します。下のボタンからSeisakuBoardにログインしてください。",
          actions: [{
            type: "uri",
            label: "SeisakuBoardと連携する",
            uri: input.accountLinkPageUrl,
          }],
        },
      }],
    },
  });
}

export async function replyLineAlreadyLinked(input: {
  replyToken: string;
  accessToken: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  await lineRequest({
    endpoint: LINE_REPLY_MESSAGE_ENDPOINT,
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl,
    body: {
      replyToken: input.replyToken,
      messages: [{
        type: "text",
        text: "このLINEアカウントはすでにSeisakuBoardと連携されています。",
      }],
    },
  });
}

export async function sendLinePushTextMessage(input: {
  lineUserId: string;
  text: string;
  accessToken: string | undefined;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  await lineRequest({
    endpoint: LINE_PUSH_MESSAGE_ENDPOINT,
    accessToken: input.accessToken,
    fetchImpl: input.fetchImpl,
    body: {
      to: input.lineUserId,
      messages: [{ type: "text", text: input.text }],
    },
  });
}
