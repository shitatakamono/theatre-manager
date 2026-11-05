type LineTestUserDependencies = {
  verifyIdToken: (idToken: string) => Promise<{ uid: string }>;
  getProjectRole: (projectId: string, uid: string) => Promise<string | null>;
  getLatestFollow: () => Promise<{ lineUserId: string } | null>;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export function createLineTestUserGetHandler(dependencies: LineTestUserDependencies) {
  return async function GET(request: Request): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "ログインが必要です", code: "unauthorized" }, 401);

    let uid: string;
    try {
      uid = (await dependencies.verifyIdToken(match[1])).uid;
    } catch {
      return json({ error: "認証情報を確認できませんでした", code: "unauthorized" }, 401);
    }

    const projectId = new URL(request.url).searchParams.get("projectId")?.trim() ?? "";
    if (!projectId) {
      return json({ error: "公演を指定してください", code: "invalid_request" }, 400);
    }

    try {
      const role = await dependencies.getProjectRole(projectId, uid);
      if (role !== "owner") {
        return json({ error: "この操作を行う権限がありません", code: "forbidden" }, 403);
      }
      const latestFollow = await dependencies.getLatestFollow();
      if (!latestFollow) {
        return json({ error: "テスト用LINEユーザーIDがありません", code: "not_found" }, 404);
      }
      return json({ success: true, lineUserId: latestFollow.lineUserId }, 200);
    } catch {
      console.error("line_test_user_request_failed");
      return json({ error: "LINEユーザーIDを確認できませんでした", code: "request_failed" }, 500);
    }
  };
}
