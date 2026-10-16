import type { ProjectRole } from "../auth.ts";
import {
  REHEARSAL_IMPORT_IMAGE_TYPES,
  REHEARSAL_IMPORT_MAX_IMAGE_BYTES,
  RehearsalImportProviderError,
  RehearsalImportSchemaError,
  RehearsalImportTimeoutError,
  canUseRehearsalScreenshotImport,
  detectImageMimeType,
  parseRehearsalImportResponse,
  revalidateRehearsalImportResponse,
} from "../rehearsal-import.ts";

export type RehearsalImportHandlerDependencies = {
  verifyIdToken: (idToken: string) => Promise<{ uid: string }>;
  getProjectRole: (projectId: string, uid: string) => Promise<ProjectRole | null>;
  analyzeImage: (input: { bytes: Uint8Array; mimeType: string }) => Promise<unknown>;
};

type RouteContext = { params: Promise<{ projectId: string }> };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export function createRehearsalImportPostHandler(dependencies: RehearsalImportHandlerDependencies) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    if (!match) return json({ error: "ログインが必要です" }, 401);

    let uid: string;
    try {
      ({ uid } = await dependencies.verifyIdToken(match[1]));
    } catch {
      return json({ error: "認証情報を確認できませんでした" }, 401);
    }

    const { projectId: rawProjectId } = await context.params;
    const projectId = rawProjectId?.trim();
    if (!projectId || projectId.includes("/") || projectId.length > 1500) {
      return json({ error: "公演情報が不正です" }, 400);
    }

    let role: ProjectRole | null;
    try {
      role = await dependencies.getProjectRole(projectId, uid);
    } catch {
      return json({ error: "この公演の権限を確認できませんでした" }, 403);
    }
    if (!canUseRehearsalScreenshotImport(role)) {
      return json({ error: "スクリーンショットを解析する権限がありません" }, 403);
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return json({ error: "画像の送信形式が不正です" }, 400);
    }
    const image = formData.get("image");
    if (!(image instanceof File)) return json({ error: "画像を選択してください" }, 400);
    if (image.size > REHEARSAL_IMPORT_MAX_IMAGE_BYTES) {
      return json({ error: "画像は4MB以下にしてください" }, 413);
    }
    if (!REHEARSAL_IMPORT_IMAGE_TYPES.includes(image.type as never)) {
      return json({ error: "PNG、JPEG、WEBPの画像を選択してください" }, 400);
    }

    const bytes = new Uint8Array(await image.arrayBuffer());
    const detectedMimeType = detectImageMimeType(bytes);
    if (!detectedMimeType || detectedMimeType !== image.type) {
      return json({ error: "画像ファイルの内容を確認できませんでした" }, 400);
    }

    try {
      const providerResult = await dependencies.analyzeImage({ bytes, mimeType: detectedMimeType });
      const parsed = parseRehearsalImportResponse(providerResult);
      const result = revalidateRehearsalImportResponse(parsed);
      if (result.rows.length === 0) {
        return json({ error: "予約申込一覧の行を認識できませんでした" }, 422);
      }
      return json(result, 200);
    } catch (error) {
      if (error instanceof RehearsalImportTimeoutError) {
        return json({ error: "画像解析がタイムアウトしました。時間をおいて再度お試しください" }, 504);
      }
      if (error instanceof RehearsalImportSchemaError || error instanceof RehearsalImportProviderError) {
        return json({ error: "画像解析サービスから正しい結果を取得できませんでした" }, 502);
      }
      console.error("稽古予約画像の解析に失敗しました", error instanceof Error ? error.name : "UnknownError");
      return json({ error: "画像を解析できませんでした。時間をおいて再度お試しください" }, 502);
    }
  };
}
