import { LineProjectLinkError } from "./line-link-events.ts";

type Context = { params: Promise<{ projectId: string }> };

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

function identifier(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized && normalized.length <= 1500 && !normalized.includes("/") ? normalized : null;
}

export function createLineLinkEventHandlers(dependencies: {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  list: (input: { uid: string; projectId: string }) => Promise<unknown>;
  repair: (input: { ownerUid: string; projectId: string; personId: string }) => Promise<unknown>;
}) {
  async function authenticate(request: Request, context: Context) {
    const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return json({ error: "ログインが必要です", code: "unauthorized" }, 401);
    try {
      const token = await dependencies.verifyIdToken(bearer);
      const projectId = identifier((await context.params).projectId);
      if (!projectId) return json({ error: "公演情報が不正です", code: "invalid_request" }, 400);
      return { uid: token.uid, projectId };
    } catch {
      return json({ error: "認証情報を確認できませんでした", code: "unauthorized" }, 401);
    }
  }

  function failure(error: unknown): Response {
    if (error instanceof LineProjectLinkError) {
      const messages: Record<string, string> = {
        forbidden: "この操作を行う権限がありません",
        not_found: "関係者情報が見つかりません",
        not_linked: "この関係者は現在システム利用者と連携されていません",
        privileged_member: "OwnerまたはEditorの連携は自動解除できません。権限を確認してください。",
        other_person_linked: "同じ利用者が別の関係者にも連携されているため、自動解除できません。",
        link_inconsistent: "連携情報に不整合があるため、自動解除できません。",
        membership_inconsistent: "利用権情報に不整合があるため、自動解除できません。",
      };
      return json({ error: messages[error.code] ?? "LINE連携を処理できませんでした", code: error.code }, error.status);
    }
    console.error("line_link_event_request_failed", { name: error instanceof Error ? error.name : "unknown" });
    return json({ error: "LINE連携情報を処理できませんでした", code: "line_link_request_failed" }, 500);
  }

  return {
    GET: async (request: Request, context: Context) => {
      const auth = await authenticate(request, context);
      if (auth instanceof Response) return auth;
      try {
        return json({ events: await dependencies.list(auth) }, 200);
      } catch (error) { return failure(error); }
    },
    POST: async (request: Request, context: Context) => {
      const auth = await authenticate(request, context);
      if (auth instanceof Response) return auth;
      let body: Record<string, unknown>;
      try { body = await request.json() as Record<string, unknown>; } catch {
        return json({ error: "送信内容が不正です", code: "invalid_request" }, 400);
      }
      const personId = identifier(body.personId);
      if (!personId) return json({ error: "関係者情報が不正です", code: "invalid_request" }, 400);
      try {
        await dependencies.repair({ ownerUid: auth.uid, projectId: auth.projectId, personId });
        return json({ success: true }, 200);
      } catch (error) { return failure(error); }
    },
  };
}
