import { getTasks, addTask, toggleTask } from "@/lib/firestore";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import TaskForm from "./TaskForm";

export default async function TasksPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  const tasks = await getTasks(projectId);

  // ▼ 固定カテゴリ（後で管理画面から変更可能にする）
  const CATEGORY_MAP = {
    演出: [],
    舞台監督: ["音響", "照明", "映像", "大道具", "小道具", "衣装", "メイク"],
    制作: ["広報", "受付", "会計"],
    その他: ["雑務", "未分類"],
  };

  // ▼ 新規タスク追加（Server Action）
  async function createTask(formData: FormData) {
    "use server";

    const title = String(formData.get("title") || "");
    const stage = String(formData.get("stage") || "");
    const category_parent = String(formData.get("category_parent") || "");
    const category_child = String(formData.get("category_child") || "");

    if (!title) return;

    await addTask(projectId, {
      title,
      stage,
      category_parent,
      category_child,
    });

    revalidatePath(`/projects/${projectId}/tasks`);
  }

  // ▼ 完了 / 未完了切り替え
  async function toggle(id: string, done: boolean) {
    "use server";
    await toggleTask(projectId, id, done);
    revalidatePath(`/projects/${projectId}/tasks`);
  }

  return (
    <div className="px-4 py-6 max-w-xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-center mb-6">タスク一覧</h1>

      {/* ▼ タスク追加フォーム（Client Component） */}
      <TaskForm CATEGORY_MAP={CATEGORY_MAP} onSubmit={createTask} />

      {/* ▼ タスクカード一覧 */}
      <div className="space-y-4">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`relative overflow-hidden p-4 rounded-xl shadow border bg-white transition active:scale-[0.98]`}
          >
            {/* 左帯（ステータス色） */}
            <div
              className={`absolute left-0 top-0 h-full w-2 ${
                task.done ? "bg-gray-400" : "bg-blue-500"
              }`}
            ></div>

            <div className="flex items-start gap-4 pl-4">
              {/* ▼ チェックボタン */}
              <form action={() => toggle(task.id, !task.done)}>
                <button
                  className={`w-8 h-8 flex items-center justify-center rounded-full border text-lg transition active:scale-90 ${
                    task.done
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-gray-500 border-gray-300"
                  }`}
                >
                  {task.done ? "✓" : ""}
                </button>
              </form>

              {/* ▼ タスク情報 */}
              <div className="flex-1">
                {/* タスク名称 */}
                <div
                  className={`text-base font-medium leading-tight ${
                    task.done ? "line-through text-gray-400" : "text-gray-800"
                  }`}
                >
                  {task.title}
                </div>

                {/* ▼ カテゴリバッジ */}
                <div className="flex gap-2 mt-1 text-xs">
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">
                    {task.stage}
                  </span>

                  <span className="px-2 py-1 bg-green-100 text-green-800 rounded">
                    {task.category_parent}
                  </span>

                  {task.category_child ? (
                    <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded">
                      {task.category_child}
                    </span>
                  ) : null}
                </div>

                {/* ▼ 作成日 */}
                <div className="mt-1 text-xs text-gray-500">
                  作成日:{" "}
                  {task.createdAt?.toDate?.().toLocaleDateString?.() ?? "—"}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ▼ 公演トップへ戻る */}
      <Link href={`/projects/${projectId}`}>
        <button className="mt-6 bg-gray-600 text-white px-4 py-2 rounded-lg w-full hover:bg-gray-700 active:scale-95 transition">
          公演トップへ戻る
        </button>
      </Link>
    </div>
  );
}
