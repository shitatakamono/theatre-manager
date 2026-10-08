import { NextResponse } from "next/server";
import { updateProjectPerformanceSection } from "@/lib/firestore";
import {
  isPerformanceSection,
  type PerformanceSectionMap,
} from "@/lib/performance";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const body = (await request.json()) as {
      section?: unknown;
      value?: unknown;
    };

    if (!isPerformanceSection(body.section) || body.value === undefined) {
      return NextResponse.json(
        { error: "Invalid performance information" },
        { status: 400 }
      );
    }

    const section = body.section;
    await updateProjectPerformanceSection(
      projectId,
      section,
      body.value as PerformanceSectionMap[typeof section]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("公演情報更新エラー:", error);
    return NextResponse.json(
      { error: "公演情報を保存できませんでした" },
      { status: 500 }
    );
  }
}
