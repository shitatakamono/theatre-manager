import { canEditProject, type ProjectRole } from "../auth.ts";

type Status = { enabled: boolean; path: string | null };
type Context = { params: Promise<{ projectId: string }> };

export type RehearsalShareHandlerDependencies = {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  getProjectRole: (projectId: string, uid: string) => Promise<ProjectRole | null>;
  getStatus: (projectId: string) => Promise<Status>;
  issue: (projectId: string, uid: string) => Promise<Status>;
  regenerate: (projectId: string, uid: string) => Promise<Status>;
  disable: (projectId: string, uid: string) => Promise<Status>;
};

function error(message: string, code: string, status: number): Response {
  return Response.json({ error: message, code }, { status });
}

function projectIdFrom(raw: string): string | null {
  const value = raw?.trim();
  return value && value.length <= 1500 && !value.includes("/") ? value : null;
}

async function authorize(
  request: Request,
  context: Context,
  dependencies: RehearsalShareHandlerDependencies
): Promise<{ response: Response } | { projectId: string; uid: string }> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return { response: error("ログインが必要です", "authentication_required", 401) };
  let uid: string;
  try {
    uid = (await dependencies.verifyIdToken(token)).uid;
  } catch {
    return { response: error("認証情報を確認できませんでした", "invalid_authentication", 401) };
  }
  const raw = (await context.params).projectId;
  const projectId = projectIdFrom(raw);
  if (!projectId) return { response: error("公演情報が不正です", "invalid_project", 400) };
  const role = await dependencies.getProjectRole(projectId, uid);
  if (!canEditProject(role ?? undefined)) return { response: error("共有設定を変更する権限がありません", "forbidden", 403) };
  return { projectId, uid };
}

function createHandler(operation: "getStatus" | "issue" | "regenerate" | "disable") {
  return (dependencies: RehearsalShareHandlerDependencies) => async (request: Request, context: Context): Promise<Response> => {
    try {
      const auth = await authorize(request, context, dependencies);
      if ("response" in auth) return auth.response;
      const result = operation === "getStatus"
        ? await dependencies.getStatus(auth.projectId)
        : await dependencies[operation](auth.projectId, auth.uid);
      return Response.json(result, { status: 200 });
    } catch (caught) {
      console.error("rehearsal_share_request_failed", { name: caught instanceof Error ? caught.name : "UnknownError" });
      return error("共有設定を更新できませんでした", "share_operation_failed", 500);
    }
  };
}

export const createRehearsalShareGetHandler = createHandler("getStatus");
export const createRehearsalSharePostHandler = createHandler("issue");
export const createRehearsalSharePatchHandler = createHandler("regenerate");
export const createRehearsalShareDeleteHandler = createHandler("disable");
