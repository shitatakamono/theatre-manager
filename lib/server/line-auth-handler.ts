import {
  buildLineLoginAuthorizationUrl,
  createLineLoginCodeChallenge,
} from "../line-login.ts";
import { LineAuthError } from "../line-auth.ts";

type AuthConfig = {
  appOrigin: string;
  channelId: string;
  channelSecret: string;
  redirectUri: string;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

function completionRedirect(
  appOrigin: string,
  result: "ticket" | "unlinked" | "error",
  ticket?: string
): Response {
  const url = new URL("/line/auth/complete", appOrigin);
  url.searchParams.set("result", result);
  if (result === "ticket" && ticket) {
    url.hash = new URLSearchParams({ ticket }).toString();
  }
  return Response.redirect(url, 303);
}

export function createLineAuthStartHandler(dependencies: {
  createState: () => Promise<{ state: string; nonce: string; codeVerifier: string }>;
  getConfig: () => Pick<AuthConfig, "channelId" | "redirectUri">;
  logError?: (event: string) => void;
}) {
  return async function POST(): Promise<Response> {
    try {
      const config = dependencies.getConfig();
      const temporary = await dependencies.createState();
      return json({
        redirectUrl: buildLineLoginAuthorizationUrl({
          channelId: config.channelId,
          redirectUri: config.redirectUri,
          state: temporary.state,
          nonce: temporary.nonce,
          codeChallenge: createLineLoginCodeChallenge(temporary.codeVerifier),
        }),
      }, 200);
    } catch {
      (dependencies.logError ?? console.error)("line_auth_start_failed");
      return json({ error: "LINEログインを開始できませんでした" }, 500);
    }
  };
}

export function createLineAuthCallbackHandler(dependencies: {
  readState: (state: string) => Promise<{
    status: "pending" | "consumed" | "failed";
    nonce: string;
    codeVerifier: string;
  }>;
  failState: (state: string) => Promise<void>;
  exchangeCode: (input: {
    code: string;
    redirectUri: string;
    channelId: string;
    channelSecret: string;
    codeVerifier: string;
  }) => Promise<{ accessToken: string; idToken: string }>;
  verifyIdToken: (input: {
    idToken: string;
    channelId: string;
    nonce: string;
  }) => Promise<{ lineUserId: string }>;
  completeState: (input: { state: string; lineUserId: string }) => Promise<
    { outcome: "ticket_created"; ticket: string } | { outcome: "not_linked" }
  >;
  getConfig: () => AuthConfig;
  logError?: (event: string) => void;
}) {
  return async function GET(request: Request): Promise<Response> {
    let config: AuthConfig;
    try {
      config = dependencies.getConfig();
    } catch {
      return new Response("LINEログインを完了できませんでした", {
        status: 500,
        headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    }
    const requestUrl = new URL(request.url);
    const state = requestUrl.searchParams.get("state") ?? "";
    if (!state) return completionRedirect(config.appOrigin, "error");

    try {
      const saved = await dependencies.readState(state);
      if (saved.status !== "pending") return completionRedirect(config.appOrigin, "error");
      const code = requestUrl.searchParams.get("code") ?? "";
      if (requestUrl.searchParams.has("error") || !code) {
        await dependencies.failState(state);
        return completionRedirect(config.appOrigin, "error");
      }
      const tokens = await dependencies.exchangeCode({
        code,
        redirectUri: config.redirectUri,
        channelId: config.channelId,
        channelSecret: config.channelSecret,
        codeVerifier: saved.codeVerifier,
      });
      const identity = await dependencies.verifyIdToken({
        idToken: tokens.idToken,
        channelId: config.channelId,
        nonce: saved.nonce,
      });
      const completed = await dependencies.completeState({
        state,
        lineUserId: identity.lineUserId,
      });
      return completed.outcome === "ticket_created"
        ? completionRedirect(config.appOrigin, "ticket", completed.ticket)
        : completionRedirect(config.appOrigin, "unlinked");
    } catch (error) {
      try {
        await dependencies.failState(state);
      } catch {
        // Preserve the original safe failure category.
      }
      (dependencies.logError ?? console.error)(
        error instanceof LineAuthError ? "line_auth_callback_rejected" : "line_auth_callback_failed"
      );
      return completionRedirect(config.appOrigin, "error");
    }
  };
}

export function createLineAuthExchangeHandler(dependencies: {
  consumeTicket: (ticket: string) => Promise<string>;
  getUser: (uid: string) => Promise<unknown>;
  createCustomToken: (uid: string) => Promise<string>;
  logError?: (event: string) => void;
}) {
  return async function POST(request: Request): Promise<Response> {
    let ticket = "";
    try {
      const body = await request.json() as { ticket?: unknown };
      ticket = typeof body.ticket === "string" ? body.ticket : "";
    } catch {
      return json({ error: "LINEログイン情報を確認できませんでした" }, 400);
    }
    if (!ticket) return json({ error: "LINEログイン情報を確認できませんでした" }, 400);

    try {
      const uid = await dependencies.consumeTicket(ticket);
      await dependencies.getUser(uid);
      const customToken = await dependencies.createCustomToken(uid);
      return json({ customToken }, 200);
    } catch (error) {
      (dependencies.logError ?? console.error)(
        error instanceof LineAuthError ? "line_auth_exchange_rejected" : "line_auth_exchange_failed"
      );
      return json({ error: "LINEログイン情報の有効期限が切れているか、使用済みです" }, 401);
    }
  };
}
