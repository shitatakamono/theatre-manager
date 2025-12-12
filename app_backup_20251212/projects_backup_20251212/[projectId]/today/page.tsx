import { getTasks, toggleTask, toggleTodayPin } from "@/lib/firestore";
import { revalidatePath } from "next/cache";
import Link from "next/link";

export default async function TodayPage(props: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await props.params;
  const allTasks = await getTasks(projectId);

  // 今日の yyyy-mm-dd を作成
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;

  // ▼ 今日のタスク抽出
  const todayTasks = allTasks.filter((task) => {
    // 完了済みは表示しない
    if (task.done) return false;

    // ピン留めタスクは必ず表示
    if (task.today_flag) return true;

    // 期限なしは表示しない
    if (!task.due_date) return false;

    // 期限ベースで Today に含める
    return task.due_date <= todayStr;
  });

  // ▼ 完了切り替え
  async function toggle(id: string, done: boolean) {
    "use server";
    await toggleTask(projectId, id, done);
    revalidatePath(`/projects/${projectId}/today`);
  }

  // ▼ ピン留め切り替え
  async function togglePin(id: string, flag: boolean) {
    "use server";
    await toggleTodayPin(projectId, id, flag);
    revalidatePath(`/projects/${projectId}/today`);
  }

  return (
    <div className="px-4 py-6 max-w-xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold text-center">今日のタスク</h1>

      {todayTasks.length === 0 && (
        <p className="text-center text-gray-500">今日やるタスクはありません</p>
      )}

      {/* ▼ タスク一覧 */}
      <div className="space-y-4">
        {todayTasks.map((task) => (
          <div
            key={task.id}
            className="relative overflow-hidden p-4 rounded-xl shadow border bg-white transition"
          >
            {/* 左帯：期限切れ → 赤、当日 → 黄色、ピン留め → 青 */}
            <div
              className={`absolute left-0 top-0 h-full w-2 ${
                task.today_flag
                  ? "bg-blue-500"
                  : task.due_date < todayStr
                  ? "bg-red-500"
                  : "bg-yellow-500"
              }`}
            ></div>

            <div className="flex gap-4 pl-4">

              {/* ▼ 完了ボタン */}
              <form action={() => toggle(task.id, !task.done)}>
                <button
                  className={`w-8 h-8 flex items-center justify-center rounded-full border text-lg ${
                    task.done
                      ? "bg-green-600 text-white"
                      : "bg-white text-gray-500"
                  }`}
                >
                  {task.done ? "✓" : ""}
                </button>
              </form>

              {/* ▼ タスク情報 */}
              <div className="flex-1">
                <div className="text-base font-medium">{task.title}</div>

                {/* カテゴリバッジ */}
                <div className="flex gap-2 mt-1 text-xs">
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">{task.stage}</span>
                  <span className="px-2 py-1 bg-green-100 text-green-800 rounded">{task.category_parent}</span>
                  {task.category_child && (
                    <span className="px-2 py-1 bg-gray-200 text-gray-700 rounded">
                      {task.category_child}
                    </span>
                  )}
                </div>

                {/* 期限 */}
                {task.due_date && (
                  <div className="text-xs text-gray-500 mt-1">期限: {task.due_date}</div>
                )}
              </div>

              {/* ▼ ピン留めボタン */}
              <form action={() => togglePin(task.id, !task.today_flag)}>
                <button
                  className={`px-3 py-1 text-sm rounded border ${
                    task.today_flag ? "bg-blue-200 border-blue-400" : "bg-white border-gray-300"
                  }`}
                >
                  📌
                </button>
              </form>

            </div>
          </div>
        ))}
      </div>

      {/* ▼ 公演トップ */}
      <Link href={`/projects/${projectId}`}>
        <button className="mt-6 bg-gray-600 text-white px-4 py-2 rounded-lg w-full">
          公演トップへ戻る
        </button>
      </Link>
    </div>
  );
}
