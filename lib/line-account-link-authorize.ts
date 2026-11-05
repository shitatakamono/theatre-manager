export const LINE_ACCOUNT_LINK_DIALOG_URL = "https://access.line.me/dialog/bot/accountLink";

export class LineAccountLinkAuthorizeError extends Error {
  readonly code: "invalid_link_token";

  constructor() {
    super("LINE連携情報が不正です");
    this.name = "LineAccountLinkAuthorizeError";
    this.code = "invalid_link_token";
  }
}

export function requireLineLinkToken(value: unknown): string {
  if (typeof value !== "string") throw new LineAccountLinkAuthorizeError();
  const token = value.trim();
  if (token.length < 10 || token.length > 512 || !/^[\x21-\x7E]+$/.test(token)) {
    throw new LineAccountLinkAuthorizeError();
  }
  return token;
}

export function buildLineAccountLinkRedirectUrl(input: {
  linkToken: string;
  nonce: string;
}): string {
  const url = new URL(LINE_ACCOUNT_LINK_DIALOG_URL);
  url.searchParams.set("linkToken", requireLineLinkToken(input.linkToken));
  url.searchParams.set("nonce", input.nonce);
  return url.toString();
}
