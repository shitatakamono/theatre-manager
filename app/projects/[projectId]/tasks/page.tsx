// app/projects/[projectId]/tasks/page.tsx

import { getTasks, addTask, toggleTask } from "@/lib/firestore";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export default async function TasksPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;

  // ------------------------------
  // Server Action: タスク追加
  // ------------------------------
  async function createTask(formData: FormData) {
    "use server";

    const title = String(formData.get("title") || "");
    if (!title) return;

    await addTask(projectId, title);
    revalidatePath(`/projects/${projectId}/tasks`);
  }

  // ------------------------------
  // Server Action: 完了切替
  // ------------------------------
  async function toggleDone(taskId: string, done: boolean) {
    "use server";

    await toggleTask(projectId, taskId, done);
    revalidatePath(`/projects/${projectId}/tasks`);
  }

  const tasks = await getTasks(projectId);

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">タスク一覧</h1>

      {/* -------- タスク追加フォーム -------- */}
      <form action={createTask} className="flex gap-2">
        <input
          type="text"
          name="title"
          placeholder="タスク名を入力"
          className="border p-2 rounded flex-1"
          required
        />
        <button className="bg-blue-600 text-white px-4 rounded">
          追加
        </button>
      </form>

      {/* -------- タスク一覧 -------- */}
      <div className="space-y-3">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-3 border p-3 rounded">
            {/* 完了切替（bind で安全に渡す） */}
            <form action={toggleDone.bind(null, task.id, !task.done)}>
              <button
                className={`w-6 h-6 border rounded flex items-center justify-center ${
                  task.done ? "bg-blue-600 text-white" : ""
                }`}
              >
                {task.done ? "✓" : ""}
              </button>
            </form>

            {/* タスク名 */}
            <span className={task.done ? "line-through text-gray-400" : ""}>
              {task.title}
            </span>
          </div>
        ))}
      </div>

      <Link href={`/projects/${projectId}`}>
        <button className="bg-gray-600 text-white px-4 py-2 rounded">
          公演トップへ戻る
        </button>
      </Link>
    </div>
  );
}
