import { LineInviteSignupError } from "../line-invite-signup.ts";

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

async function bodyToken(request: Request): Promise<string> {
  try {
    const body = await request.json() as { signupToken?: unknown };
    return typeof body.signupToken === "string" ? body.signupToken : "";
  } catch { return ""; }
}

export function createLineInviteSignupPreviewHandler(dependencies: {
  preview: (token: string) => Promise<{ projectName: string; displayName: string | null } | null>;
}) {
  return async function POST(request: Request): Promise<Response> {
    const token = await bodyToken(request);
    if (!token) return json({ error: "登録情報を確認できませんでした" }, 400);
    try {
      const preview = await dependencies.preview(token);
      return preview
        ? json({ signup: preview }, 200)
        : json({ error: "登録情報の有効期限が切れているか、使用済みです" }, 404);
    } catch {
      return json({ error: "登録情報を確認できませんでした" }, 400);
    }
  };
}

export function createLineInviteSignupHandler(dependencies: {
  complete: (token: string) => Promise<{ ticket: string; projectId: string }>;
  logError?: (event: string) => void;
}) {
  return async function POST(request: Request): Promise<Response> {
    const token = await bodyToken(request);
    if (!token) return json({ error: "登録情報を確認できませんでした" }, 400);
    try {
      return json(await dependencies.complete(token), 200);
    } catch (error) {
      (dependencies.logError ?? console.error)(
        error instanceof LineInviteSignupError ? "line_invite_signup_rejected" : "line_invite_signup_failed"
      );
      const status = error instanceof LineInviteSignupError ? error.status : 500;
      return json({
        error: status === 503
          ? "登録処理を完了できませんでした。時間をおいてもう一度お試しください。"
          : "この招待では新しいアカウントを作成できません。",
      }, status);
    }
  };
}
