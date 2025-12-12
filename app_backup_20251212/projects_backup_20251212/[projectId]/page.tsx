import { getProject, getTasksCount } from "@/lib/firestore";
import Link from "next/link";

export default async function ProjectPage(
  { params }: { params: { projectId: string } }
) {
  const projectId = params.projectId;

  const project = await getProject(projectId);
  const { done, total } = await getTasksCount(projectId);
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  if (!project) {
    return <div className="p-6">公演が見つかりません。</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">{project.title}</h1>

      <div className="mb-6 p-4 border rounded bg-white">
        <p>プロジェクト期間: {project.start_date ?? "未設定"} ～ {project.end_date ?? "未設定"}</p>
        <p>公演期間: {project.show_start_date ?? "未設定"} ～ {project.show_end_date ?? "未設定"}</p>

        <div className="mt-4">
          <p className="text-sm text-gray-700 mb-1">
            タスク進捗: {done} / {total}（{progress}%）
          </p>

          <div className="w-full bg-gray-200 h-3 rounded-full overflow-hidden">
            <div
              className="h-3 bg-blue-600 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <Link href={`/projects/${projectId}/tasks`}>
          <button className="bg-blue-600 text-white px-4 py-2 rounded w-full">
            タスク一覧を見る
          </button>
        </Link>

        <Link href={`/projects/${projectId}/today`}>
          <button className="bg-red-600 text-white px-4 py-2 rounded w-full hover:bg-red-700 transition">
            今日のタスクを見る
          </button>
        </Link>

        <Link href="/">
          <button className="bg-gray-500 text-white px-4 py-2 rounded w-full">
            公演一覧に戻る
          </button>
        </Link>
      </div>
    </div>
  );
}
