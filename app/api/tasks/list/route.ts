import { NextResponse } from "next/server";
import { getTasks } from "@/lib/firestore";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ tasks: [] });
  }

  const tasks = await getTasks(projectId);
  return NextResponse.json({ tasks });
}
