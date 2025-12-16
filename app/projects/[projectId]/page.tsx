// app/projects/[projectId]/page.tsx

import { getProject } from "@/lib/firestore";
import Link from "next/link";

export default async function ProjectPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  // Next.js 16: params は Promise のため await する
  const { projectId } = await props.params;

  const project = await getProject(projectId);

  if (!project) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-bold mb-2">公演が見つかりません。</h1>
        <Link href="/">
          <button className="bg-gray-600 text-white px-4 py-2 rounded">
            公演一覧に戻る
          </button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold">{project.title}</h1>

      {/* タスク一覧へ */}
      <Link href={`/projects/${projectId}/tasks`}>
        <button className="bg-blue-600 text-white px-4 py-2 rounded">
          タスク一覧を見る
        </button>
      </Link>

      {/* 公演一覧へ */}
      <Link href="/">
        <button className="bg-gray-600 text-white px-4 py-2 rounded">
          公演一覧に戻る
        </button>
      </Link>
    </div>
  );
}
