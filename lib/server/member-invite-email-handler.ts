import { InviteEmailRequestError } from "../member-invite-email.ts";

export type MemberInviteEmailHandlerDependencies = {
  loadAuthModule: () => Promise<{
    initializeFirebaseAdminAuth: () => {
      verifyIdToken: (idToken: string) => Promise<{ uid: string }>;
    };
  }>;
  sendPendingInviteEmail: (input: {
    uid: string;
    projectId: string;
    inviteEmail: string;
  }) => Promise<{ email: string }>;
  logger?: Pick<Console, "error">;
};

function firebaseAuthErrorSummary(error: unknown): { name: string; code: string | null } {
  if (typeof error !== "object" || error === null) {
    return { name: "UnknownError", code: null };
  }

  const candidate = error as { name?: unknown; code?: unknown };
  return {
    name: typeof candidate.name === "string" ? candidate.name : "UnknownError",
    code: typeof candidate.code === "string" ? candidate.code : null,
  };
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function authenticationFailure(
  dependencies: MemberInviteEmailHandlerDependencies,
  eventName: string,
  error: unknown
): Response {
  (dependencies.logger ?? console).error(
    eventName,
    firebaseAuthErrorSummary(error)
  );
  return json({ error: "認証情報を確認できませんでした" }, 401);
}

export function createMemberInviteEmailPostHandler(
  dependencies: MemberInviteEmailHandlerDependencies
) {
  return async function POST(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "ログインが必要です" }, 401);

    let authModule: Awaited<ReturnType<MemberInviteEmailHandlerDependencies["loadAuthModule"]>>;
    try {
      authModule = await dependencies.loadAuthModule();
    } catch (error) {
      return authenticationFailure(dependencies, "member_invite_auth_module_import_failed", error);
    }

    let firebaseAdminAuth: ReturnType<typeof authModule.initializeFirebaseAdminAuth>;
    try {
      firebaseAdminAuth = authModule.initializeFirebaseAdminAuth();
    } catch (error) {
      return authenticationFailure(dependencies, "member_invite_admin_initialization_failed", error);
    }

    let uid: string;
    try {
      ({ uid } = await firebaseAdminAuth.verifyIdToken(match[1]));
    } catch (error) {
      return authenticationFailure(dependencies, "member_invite_verify_id_token_failed", error);
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return json({ error: "送信内容が不正です" }, 400);
    }

    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const inviteEmail = typeof body.inviteEmail === "string" ? body.inviteEmail.trim().toLowerCase() : "";
    if (!projectId || projectId.includes("/") || projectId.length > 1500
      || !inviteEmail || inviteEmail.includes("/") || inviteEmail.length > 254) {
      return json({ error: "招待情報が不正です" }, 400);
    }

    try {
      const result = await dependencies.sendPendingInviteEmail({ uid, projectId, inviteEmail });
      return json({ success: true, email: result.email, emailStatus: "sent" }, 200);
    } catch (error) {
      if (error instanceof InviteEmailRequestError) {
        const sendFailed = error.code === "send_failed" || error.code === "server_configuration";
        return json({
          error: error.message,
          code: error.code,
          ...(sendFailed ? { emailStatus: "failed" } : {}),
        }, error.status);
      }
      console.error("招待メール送信エラー:", error);
      return json({
        error: "招待メールを送信できませんでした。時間をおいて再度お試しください",
        code: "send_failed",
        emailStatus: "failed",
      }, 502);
    }
  };
}
