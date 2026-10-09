import { NextResponse } from "next/server";
import { updateProjectProductionBlock } from "@/lib/firestore";
import {
  isManagedProductionSection,
  isProductionBlock,
  type ProductionSectionDataMap,
} from "@/lib/production-management";

type RouteContext = {
  params: Promise<{ projectId: string; section: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { projectId, section } = await context.params;
    const body = (await request.json()) as { block?: unknown; value?: unknown };

    if (
      !isManagedProductionSection(section) ||
      !isProductionBlock(section, body.block) ||
      body.value === undefined
    ) {
      return NextResponse.json(
        { error: "Invalid production management information" },
        { status: 400 }
      );
    }

    const block = body.block;
    await updateProjectProductionBlock(
      projectId,
      section,
      block,
      body.value as ProductionSectionDataMap[typeof section][typeof block]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("制作管理情報更新エラー:", error);
    return NextResponse.json(
      { error: "制作管理情報を保存できませんでした" },
      { status: 500 }
    );
  }
}
