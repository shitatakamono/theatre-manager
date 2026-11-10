import type { DecodedIdToken, UserRecord } from "firebase-admin/auth";

import { ProjectInviteLinkError } from "./project-invite-links.ts";

type Context = { params: Promise<{ projectId: string }> };

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

function failure(error: unknown): Response {
  if (error instanceof ProjectInviteLinkError) {
    return json({ error: error.message, code: error.code }, error.status);
  }
  console.error("project_invite_link_request_failed", {
    name: error instanceof Error ? error.name : "unknown",
  });
  return json({ error: "招待リンクを処理できませんでした", code: "invite_request_failed" }, 500);
}

async function authenticate<T extends { uid: string }>(
  request: Request,
  verifyIdToken: (token: string) => Promise<T>
): Promise<T | Response> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "ログインが必要です", code: "unauthorized" }, 401);
  try {
    return await verifyIdToken(token);
  } catch {
    return json({ error: "認証情報を確認できませんでした", code: "unauthorized" }, 401);
  }
}

function projectIdFrom(raw: string): string | null {
  const value = raw.trim();
  return value && !value.includes("/") && value.length <= 1500 ? value : null;
}

export function createProjectInviteLinkManagementHandlers(dependencies: {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  list: (input: { uid: string; projectId: string }) => Promise<unknown>;
  create: (input: { uid: string; projectId: string; personId?: string; appOrigin: string }) => Promise<unknown>;
  revoke: (input: { uid: string; projectId: string; inviteId: string }) => Promise<void>;
}) {
  async function authorized(request: Request, context: Context) {
    const token = await authenticate(request, dependencies.verifyIdToken);
    if (token instanceof Response) return token;
    const projectId = projectIdFrom((await context.params).projectId);
    if (!projectId) return json({ error: "公演情報が不正です", code: "invalid_request" }, 400);
    return { uid: token.uid, projectId };
  }

  return {
    GET: async (request: Request, context: Context) => {
      const auth = await authorized(request, context);
      if (auth instanceof Response) return auth;
      try {
        return json({ invites: await dependencies.list(auth) }, 200);
      } catch (error) { return failure(error); }
    },
    POST: async (request: Request, context: Context) => {
      const auth = await authorized(request, context);
      if (auth instanceof Response) return auth;
      let body: Record<string, unknown> = {};
      try { body = await request.json() as Record<string, unknown>; } catch { /* Empty body is a general invite. */ }
      const personId = typeof body.personId === "string" ? body.personId.trim() : "";
      try {
        const result = await dependencies.create({
          ...auth,
          ...(personId ? { personId } : {}),
          appOrigin: new URL(request.url).origin,
        });
        return json(result, 201);
      } catch (error) { return failure(error); }
    },
    DELETE: async (request: Request, context: Context) => {
      const auth = await authorized(request, context);
      if (auth instanceof Response) return auth;
      let body: Record<string, unknown>;
      try { body = await request.json() as Record<string, unknown>; } catch {
        return json({ error: "送信内容が不正です", code: "invalid_request" }, 400);
      }
      const inviteId = typeof body.inviteId === "string" ? body.inviteId.trim() : "";
      try {
        await dependencies.revoke({ ...auth, inviteId });
        return json({ success: true }, 200);
      } catch (error) { return failure(error); }
    },
  };
}

export function createProjectInviteLinkPreviewHandler(dependencies: {
  preview: (rawToken: string) => Promise<unknown | null>;
}) {
  return async function POST(request: Request): Promise<Response> {
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch {
      return json({ error: "招待リンクを確認できませんでした" }, 400);
    }
    const rawToken = typeof body.token === "string" ? body.token : "";
    try {
      const preview = await dependencies.preview(rawToken);
      return preview ? json({ invite: preview }, 200) : json({ error: "招待リンクを確認できませんでした" }, 404);
    } catch (error) { return failure(error); }
  };
}

export function createProjectInviteLinkClaimHandler(dependencies: {
  verifyIdToken: (token: string) => Promise<DecodedIdToken>;
  getUser: (uid: string) => Promise<UserRecord>;
  claim: (input: { uid: string; displayName?: string; email?: string; rawToken: string }) => Promise<unknown>;
}) {
  return async function POST(request: Request): Promise<Response> {
    const token = await authenticate(request, dependencies.verifyIdToken);
    if (token instanceof Response) return token;
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; } catch {
      return json({ error: "送信内容が不正です", code: "invalid_request" }, 400);
    }
    const rawToken = typeof body.token === "string" ? body.token : "";
    try {
      const user = await dependencies.getUser(token.uid);
      const result = await dependencies.claim({
        uid: token.uid,
        displayName: user.displayName ?? undefined,
        email: user.email ?? undefined,
        rawToken,
      });
      return json(result, 200);
    } catch (error) { return failure(error); }
  };
}
