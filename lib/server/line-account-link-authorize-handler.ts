import { LineAccountLinkError } from "../line-account-link.ts";
import {
  LineAccountLinkAuthorizeError,
  buildLineAccountLinkRedirectUrl,
  requireLineLinkToken,
} from "../line-account-link-authorize.ts";

type Dependencies = {
  verifyIdToken: (idToken: string) => Promise<{ uid: string }>;
  createNonce: (uid: string) => Promise<string>;
  logError?: (event: string) => void;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export function createLineAccountLinkAuthorizeHandler(dependencies: Dependencies) {
  return async function POST(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return json({ error: "ログインが必要です", code: "unauthorized" }, 401);
    }

    let uid: string;
    try {
      uid = (await dependencies.verifyIdToken(match[1])).uid;
    } catch {
      return json({ error: "認証情報を確認できませんでした", code: "unauthorized" }, 401);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return json({ error: "LINE連携情報が不正です", code: "invalid_request" }, 400);
    }

    try {
      const linkToken = requireLineLinkToken(body.linkToken);
      const nonce = await dependencies.createNonce(uid);
      return json({
        redirectUrl: buildLineAccountLinkRedirectUrl({ linkToken, nonce }),
      }, 200);
    } catch (error) {
      if (error instanceof LineAccountLinkAuthorizeError) {
        return json({ error: "LINE連携情報が不正です", code: error.code }, 400);
      }
      (dependencies.logError ?? console.error)(
        error instanceof LineAccountLinkError
          ? "line_account_link_nonce_failed"
          : "line_account_link_authorize_failed"
      );
      return json({
        error: "LINE連携を開始できませんでした",
        code: "line_account_link_unavailable",
      }, 500);
    }
  };
}
