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

function json(errorOrBody: unknown, status: number): Response {
  return Response.json(errorOrBody, { status });
}

function errorJson(error: string, code: string, status: number): Response {
  return json({ error, code }, status);
}

export function createRehearsalImportPostHandler(dependencies: RehearsalImportHandlerDependencies) {
  return async function POST(request: Request, context: RouteContext): Promise<Response> {
    try {
      const authorization = request.headers.get("authorization") ?? "";
      const match = authorization.match(/^Bearer\s+(.+)$/i);
      if (!match) return errorJson("ログインが必要です", "authentication_required", 401);

      let uid: string;
      try {
        ({ uid } = await dependencies.verifyIdToken(match[1]));
      } catch {
        return errorJson("認証情報を確認できませんでした", "invalid_authentication", 401);
      }

      const { projectId: rawProjectId } = await context.params;
      const projectId = rawProjectId?.trim();
      if (!projectId || projectId.includes("/") || projectId.length > 1500) {
        return errorJson("公演情報が不正です", "invalid_project", 400);
      }

      let role: ProjectRole | null;
      try {
        role = await dependencies.getProjectRole(projectId, uid);
      } catch {
        return errorJson("この公演の権限を確認できませんでした", "authorization_failed", 403);
      }
      if (!canUseRehearsalScreenshotImport(role)) {
        return errorJson("スクリーンショットを解析する権限がありません", "owner_required", 403);
      }

      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return errorJson("画像の送信形式が不正です", "invalid_form_data", 400);
      }
      const image = formData.get("image");
      if (!(image instanceof File)) return errorJson("画像を選択してください", "image_required", 400);
      if (image.size > REHEARSAL_IMPORT_MAX_IMAGE_BYTES) return errorJson("画像は4MB以下にしてください", "image_too_large", 413);
      if (!REHEARSAL_IMPORT_IMAGE_TYPES.includes(image.type as never)) {
        return errorJson("PNG、JPEG、WEBPの画像を選択してください", "unsupported_image_type", 400);
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await image.arrayBuffer());
      } catch {
        return errorJson("画像ファイルを読み込めませんでした", "image_read_failed", 400);
      }
      const detectedMimeType = detectImageMimeType(bytes);
      if (!detectedMimeType || detectedMimeType !== image.type) {
        return errorJson("画像ファイルの内容を確認できませんでした", "invalid_image_signature", 400);
      }

      try {
        const providerResult = await dependencies.analyzeImage({ bytes, mimeType: detectedMimeType });
        const result = revalidateRehearsalImportResponse(parseRehearsalImportResponse(providerResult));
        if (result.rows.length === 0) return errorJson("予約申込一覧の行を認識できませんでした", "reservation_rows_not_found", 422);
        return json(result, 200);
      } catch (error) {
        if (error instanceof RehearsalImportTimeoutError) {
          return errorJson("画像解析がタイムアウトしました。時間をおいて再度お試しください", "image_parse_timeout", 504);
        }
        if (error instanceof RehearsalImportSchemaError) {
          return errorJson("画像解析サービスから正しい結果を取得できませんでした", "invalid_provider_response", 502);
        }
        if (error instanceof RehearsalImportProviderError) {
          return errorJson("画像解析サービスを利用できませんでした", "image_provider_failed", 502);
        }
        console.error("rehearsal_import_failed", { name: error instanceof Error ? error.name : "UnknownError" });
        return errorJson("画像の解析に失敗しました", "image_parse_failed", 502);
      }
    } catch (error) {
      console.error("rehearsal_import_unexpected_error", { name: error instanceof Error ? error.name : "UnknownError" });
      return errorJson("画像の解析に失敗しました", "unexpected_error", 500);
    }
  };
}
