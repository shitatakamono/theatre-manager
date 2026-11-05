import {
  LineLoginError,
  buildLineLoginAuthorizationUrl,
  createLineLoginCodeChallenge,
} from "../line-login.ts";
import { LineAccountLinkError } from "../line-account-link.ts";

type StartDependencies = {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  getStatus: (uid: string) => Promise<{ connected: boolean }>;
  createState: (uid: string) => Promise<{
    state: string;
    nonce: string;
    codeVerifier: string;
  }>;
  getConfig: (request: Request) => { channelId: string; redirectUri: string };
  logError?: (event: string) => void;
};

type CallbackDependencies = {
  readState: (state: string) => Promise<{
    status: "pending" | "consumed" | "failed";
    uid: string;
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
  getFriendshipStatus: (input: { accessToken: string }) => Promise<boolean>;
  completeState: (input: {
    state: string;
    lineUserId: string;
    deliveryStatus: "reachable" | "unreachable" | "unknown";
  }) => Promise<{ outcome: "linked" | "already_linked" }>;
  getConfig: (request: Request) => {
    appOrigin: string;
    channelId: string;
    channelSecret: string;
    redirectUri: string;
  };
  logError?: (event: string) => void;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

function bearerToken(request: Request): string | null {
  return request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
}

export function createLineLoginStartHandler(dependencies: StartDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const token = bearerToken(request);
    if (!token) return json({ error: "ログインが必要です" }, 401);
    let uid: string;
    try {
      uid = (await dependencies.verifyIdToken(token)).uid;
    } catch {
      return json({ error: "認証情報を確認できませんでした" }, 401);
    }

    try {
      const status = await dependencies.getStatus(uid);
      if (status.connected) return json({ connected: true }, 200);
      const config = dependencies.getConfig(request);
      if (!config.channelId || !config.redirectUri) throw new LineLoginError("missing_configuration");
      const temporary = await dependencies.createState(uid);
      return json({
        connected: false,
        redirectUrl: buildLineLoginAuthorizationUrl({
          channelId: config.channelId,
          redirectUri: config.redirectUri,
          state: temporary.state,
          nonce: temporary.nonce,
          codeChallenge: createLineLoginCodeChallenge(temporary.codeVerifier),
        }),
      }, 200);
    } catch {
      (dependencies.logError ?? console.error)("line_login_start_failed");
      return json({ error: "LINE連携を開始できませんでした" }, 500);
    }
  };
}

function settingsRedirect(appOrigin: string, outcome: "connected" | "error"): Response {
  const url = new URL("/settings", appOrigin);
  url.searchParams.set("line", outcome);
  return Response.redirect(url, 303);
}

export function createLineLoginCallbackHandler(dependencies: CallbackDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const requestUrl = new URL(request.url);
    let config: ReturnType<CallbackDependencies["getConfig"]>;
    try {
      config = dependencies.getConfig(request);
    } catch {
      return new Response("LINE連携を完了できませんでした", {
        status: 500,
        headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
      });
    }
    const state = requestUrl.searchParams.get("state") ?? "";
    if (!state) return settingsRedirect(config.appOrigin, "error");

    try {
      const saved = await dependencies.readState(state);
      if (saved.status === "consumed") return settingsRedirect(config.appOrigin, "connected");
      if (saved.status !== "pending") return settingsRedirect(config.appOrigin, "error");
      const oauthError = requestUrl.searchParams.get("error");
      const code = requestUrl.searchParams.get("code") ?? "";
      if (oauthError || !code) {
        await dependencies.failState(state);
        return settingsRedirect(config.appOrigin, "error");
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
      let deliveryStatus: "reachable" | "unreachable" | "unknown" = "unknown";
      try {
        deliveryStatus = await dependencies.getFriendshipStatus({ accessToken: tokens.accessToken })
          ? "reachable"
          : "unreachable";
      } catch {
        deliveryStatus = "unknown";
      }
      await dependencies.completeState({
        state,
        lineUserId: identity.lineUserId,
        deliveryStatus,
      });
      return settingsRedirect(config.appOrigin, "connected");
    } catch (error) {
      try {
        await dependencies.failState(state);
      } catch {
        // Keep the original safe failure category; no identifier is logged.
      }
      (dependencies.logError ?? console.error)(
        error instanceof LineLoginError || error instanceof LineAccountLinkError
          ? "line_login_callback_rejected"
          : "line_login_callback_failed"
      );
      return settingsRedirect(config.appOrigin, "error");
    }
  };
}

export function createLineLoginStatusHandler(dependencies: {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  getStatus: (uid: string) => Promise<{
    connected: boolean;
    deliveryStatus: "reachable" | "unreachable" | "unknown" | null;
  }>;
}) {
  return async function GET(request: Request): Promise<Response> {
    const token = bearerToken(request);
    if (!token) return json({ error: "ログインが必要です" }, 401);
    let uid: string;
    try {
      uid = (await dependencies.verifyIdToken(token)).uid;
    } catch {
      return json({ error: "認証情報を確認できませんでした" }, 401);
    }
    try {
      const status = await dependencies.getStatus(uid);
      return json(status, 200);
    } catch {
      return json({ error: "LINE連携状態を確認できませんでした" }, 500);
    }
  };
}
