export const LINE_PUSH_MESSAGE_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export type LineMessagingErrorCode =
  | "line_access_token_missing"
  | "line_authentication_failed"
  | "line_rate_limited"
  | "line_request_rejected"
  | "line_server_error"
  | "line_network_error";

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
