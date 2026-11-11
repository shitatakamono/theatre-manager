import {
  buildLineLoginAuthorizationUrl,
  createLineLoginCodeChallenge,
} from "../line-login.ts";
import { generateLineAuthFlowId, LineAuthError } from "../line-auth.ts";

type AuthConfig = {
  appOrigin: string;
  channelId: string;
  channelSecret: string;
  redirectUri: string;
};

type LineAuthDiagnostic = Record<string, string | boolean | null>;
type InviteAvailability = "pending" | "expired" | "revoked" | "claimed" | "missing" | null;
type CompletionOutcome =
  | { outcome: "ticket_created"; ticket: string; lineMappingFound?: boolean; inviteAvailability?: InviteAvailability }
  | { outcome: "signup_required"; signupToken: string; lineMappingFound?: boolean; inviteAvailability?: InviteAvailability }
  | { outcome: "not_linked"; lineMappingFound?: boolean; inviteAvailability?: InviteAvailability }
  | { outcome: "invite_expired"; lineMappingFound?: boolean; inviteAvailability?: InviteAvailability }
  | { outcome: "invite_revoked"; lineMappingFound?: boolean; inviteAvailability?: InviteAvailability }
  | { outcome: "invite_used"; lineMappingFound?: boolean; inviteAvailability?: InviteAvailability }
  | { outcome: "invite_unavailable"; lineMappingFound?: boolean; inviteAvailability?: InviteAvailability };

function emitDiagnostic(
  logger: ((entry: LineAuthDiagnostic) => void) | undefined,
  entry: LineAuthDiagnostic
): void {
  const deploySha = process.env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 12) || "local";
  (logger ?? ((value) => console.info(JSON.stringify(value))))({ deploySha, ...entry });
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

function completionRedirect(
  appOrigin: string,
  result:
    | "ticket"
    | "signup"
    | "unlinked"
    | "invite_expired"
    | "invite_revoked"
    | "invite_used"
    | "invite_unavailable"
    | "error",
  opaqueValue?: string
): Response {
  const url = new URL("/line/auth/complete", appOrigin);
  url.searchParams.set("result", result);
  if (result === "ticket" && opaqueValue) {
    url.hash = new URLSearchParams({ ticket: opaqueValue }).toString();
  }
  if (result === "signup" && opaqueValue) {
    url.hash = new URLSearchParams({ signup: opaqueValue }).toString();
  }
  return Response.redirect(url, 303);
}

export function createLineAuthStartHandler(dependencies: {
  createState: (inviteToken?: string, flowId?: string) => Promise<{
    state: string;
    nonce: string;
    codeVerifier: string;
    flowId?: string;
    inviteValidated?: boolean;
    inviteBoundToState?: boolean;
  }>;
  getConfig: () => Pick<AuthConfig, "channelId" | "redirectUri">;
  logError?: (event: string) => void;
  logDiagnostic?: (entry: LineAuthDiagnostic) => void;
}) {
  return async function POST(request?: Request): Promise<Response> {
    const flowId = generateLineAuthFlowId();
    let startMode: "normal" | "invite" = "normal";
    let inviteTokenReceived = false;
    let inviteValidated = false;
    let inviteBoundToState = false;
    try {
      let inviteToken: string | undefined;
      if (request) {
        try {
          const body = await request.json() as { startMode?: unknown; inviteToken?: unknown };
          if (typeof body.inviteToken === "string" && body.inviteToken) inviteToken = body.inviteToken;
          inviteTokenReceived = Boolean(inviteToken);
          if (body.startMode === "invite" || body.startMode === "normal") {
            startMode = body.startMode;
          } else if (inviteToken) {
            // Preserve compatibility with the first Phase 2B client while never
            // treating an explicit invite start as a normal login.
            startMode = "invite";
          } else if (body.startMode !== undefined) {
            throw new LineAuthError("invalid_start_mode");
          }
        } catch {
          if (request.headers.get("content-type")?.includes("application/json")) {
            throw new LineAuthError("invalid_start_request");
          }
        }
      }
      if (startMode === "invite" && !inviteToken) {
        throw new LineAuthError("invite_token_required");
      }
      if (startMode === "normal" && inviteToken) {
        throw new LineAuthError("unexpected_invite_token");
      }
      const config = dependencies.getConfig();
      const temporary = await dependencies.createState(inviteToken, flowId);
      inviteValidated = temporary.inviteValidated === true;
      inviteBoundToState = temporary.inviteBoundToState === true;
      if (temporary.flowId !== flowId) {
        throw new LineAuthError("state_flow_mismatch");
      }
      if (startMode === "invite" && (!inviteValidated || !inviteBoundToState)) {
        throw new LineAuthError("invite_state_not_bound");
      }
      if (startMode === "normal" && inviteBoundToState) {
        throw new LineAuthError("normal_state_has_invite");
      }
      emitDiagnostic(dependencies.logDiagnostic, {
        event: "line_auth_start",
        flowId,
        startMode,
        inviteTokenReceived,
        inviteValidated,
        inviteBoundToState,
        result: "state_created",
      });
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
      emitDiagnostic(dependencies.logDiagnostic, {
        event: "line_auth_start",
        flowId,
        startMode,
        inviteTokenReceived,
        inviteValidated,
        inviteBoundToState,
        result: "error",
      });
      (dependencies.logError ?? console.error)("line_auth_start_failed");
      return json({
        error: startMode === "invite"
          ? "招待情報を確認できませんでした。招待した方に新しいリンクを発行してもらってください。"
          : "LINEログインを開始できませんでした",
      }, 500);
    }
  };
}

export function createLineAuthCallbackHandler(dependencies: {
  readState: (state: string) => Promise<{
    status: "pending" | "consumed" | "failed";
    nonce: string;
    codeVerifier: string;
    inviteId: string | null;
    flowId: string | null;
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
  }) => Promise<{ lineUserId: string; displayName?: string; photoURL?: string }>;
  completeState: (input: {
    state: string;
    lineUserId: string;
    displayName?: string;
    photoURL?: string;
  }) => Promise<CompletionOutcome>;
  getConfig: () => AuthConfig;
  logError?: (event: string) => void;
  logDiagnostic?: (entry: LineAuthDiagnostic) => void;
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

    let stateFound = false;
    let stateHasInviteId = false;
    let flowId: string | null = null;
    try {
      const saved = await dependencies.readState(state);
      stateFound = true;
      stateHasInviteId = Boolean(saved.inviteId);
      flowId = saved.flowId;
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
        ...(identity.displayName ? { displayName: identity.displayName } : {}),
        ...(identity.photoURL ? { photoURL: identity.photoURL } : {}),
      });
      const result = completed.outcome === "ticket_created"
        ? "ticket"
        : completed.outcome === "not_linked"
          ? "unlinked"
          : completed.outcome;
      emitDiagnostic(dependencies.logDiagnostic, {
        event: "line_auth_callback",
        flowId,
        stateFound,
        stateHasInviteId,
        lineMappingFound: completed.lineMappingFound ?? null,
        inviteAvailability: completed.inviteAvailability ?? (stateHasInviteId ? "pending" : null),
        result,
      });
      if (completed.outcome === "ticket_created") {
        return completionRedirect(config.appOrigin, "ticket", completed.ticket);
      }
      if (completed.outcome === "signup_required") {
        return completionRedirect(config.appOrigin, "signup", completed.signupToken);
      }
      if (completed.outcome === "invite_expired") {
        return completionRedirect(config.appOrigin, "invite_expired");
      }
      if (completed.outcome === "invite_revoked") {
        return completionRedirect(config.appOrigin, "invite_revoked");
      }
      if (completed.outcome === "invite_used") {
        return completionRedirect(config.appOrigin, "invite_used");
      }
      if (completed.outcome === "invite_unavailable") {
        return completionRedirect(config.appOrigin, "invite_unavailable");
      }
      return completionRedirect(config.appOrigin, "unlinked");
    } catch (error) {
      try {
        await dependencies.failState(state);
      } catch {
        // Preserve the original safe failure category.
      }
      (dependencies.logError ?? console.error)(
        error instanceof LineAuthError ? "line_auth_callback_rejected" : "line_auth_callback_failed"
      );
      emitDiagnostic(dependencies.logDiagnostic, {
        event: "line_auth_callback",
        flowId,
        stateFound,
        stateHasInviteId,
        lineMappingFound: null,
        inviteAvailability: null,
        result: "error",
      });
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
