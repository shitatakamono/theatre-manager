import {
  LINE_TEST_MESSAGE_TEXT,
  LineMessagingError,
} from "./line-messaging.ts";

type LineTestMessageDependencies = {
  verifyIdToken: (idToken: string) => Promise<{ uid: string }>;
  getProjectRole: (projectId: string, uid: string) => Promise<string | null>;
  sendMessage: (input: { lineUserId: string; text: string }) => Promise<void>;
  logError?: (event: string, details: { code: string; status: number | null }) => void;
};

const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/i;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export function createLineTestMessageHandler(dependencies: LineTestMessageDependencies) {
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
      return json({ error: "送信内容が不正です", code: "invalid_request" }, 400);
    }
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    const lineUserId = typeof body.lineUserId === "string" ? body.lineUserId.trim() : "";
    if (!projectId || !lineUserId) {
      return json({ error: "公演とLINEユーザーIDを指定してください", code: "invalid_request" }, 400);
    }
    if (!LINE_USER_ID_PATTERN.test(lineUserId)) {
      return json({ error: "LINEユーザーIDの形式が不正です", code: "invalid_line_user_id" }, 400);
    }

    try {
      const role = await dependencies.getProjectRole(projectId, uid);
      if (role !== "owner") {
        return json({ error: "この操作を行う権限がありません", code: "forbidden" }, 403);
      }
      await dependencies.sendMessage({ lineUserId, text: LINE_TEST_MESSAGE_TEXT });
      return json({ success: true }, 200);
    } catch (error) {
      const code = error instanceof LineMessagingError ? error.code : "line_test_message_failed";
      const status = error instanceof LineMessagingError ? error.lineStatus : null;
      (dependencies.logError ?? console.error)("line_test_message_failed", { code, status });
      return json({
        error: "LINEへのテスト送信に失敗しました",
        code,
      }, error instanceof LineMessagingError ? error.status : 500);
    }
  };
}
