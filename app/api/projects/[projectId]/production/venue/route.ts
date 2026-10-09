import { NextResponse } from "next/server";
import { updateProjectVenueSection } from "@/lib/firestore";
import {
  isVenueManagementSection,
  type VenueManagementSectionMap,
} from "@/lib/venue-management";

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

    if (!isVenueManagementSection(body.section) || body.value === undefined) {
      return NextResponse.json(
        { error: "Invalid venue management information" },
        { status: 400 }
      );
    }

    const section = body.section;
    await updateProjectVenueSection(
      projectId,
      section,
      body.value as VenueManagementSectionMap[typeof section]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("会場管理情報更新エラー:", error);
    return NextResponse.json(
      { error: "会場管理情報を保存できませんでした" },
      { status: 500 }
    );
  }
}
