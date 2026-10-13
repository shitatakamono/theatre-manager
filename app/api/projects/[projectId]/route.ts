import { NextResponse } from "next/server";
import { deleteProjectWithTasks, renameProject } from "@/lib/firestore";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";

    if (!title || title.length > 120) {
      return NextResponse.json(
        { error: "公演名は1〜120文字で入力してください" },
        { status: 400 }
      );
    }

    await renameProject(projectId, title);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("公演名変更エラー:", error);
    return NextResponse.json(
      { error: "公演名を変更できませんでした" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    await deleteProjectWithTasks(projectId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("公演削除エラー:", error);
    return NextResponse.json(
      { error: "公演を削除できませんでした。時間をおいて再度お試しください" },
      { status: 500 }
    );
  }
}
