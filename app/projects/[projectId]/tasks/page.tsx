"use client";

import { use, useEffect, useState } from "react";
import type { Task } from "@/lib/firestore";
import Link from "next/link";
import {
  TaskFilters,
  type CategoryMap,
  type TaskFilterValues,
} from "./TaskFilters";

type TasksPageProps = {
  params: Promise<{ projectId: string }>;
};

type TasksResponse = {
  tasks: Task[];
};

type CategoriesResponse = {
  map: CategoryMap;
};

export default function TasksPage({ params }: TasksPageProps) {
  const { projectId } = use(params);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [filtered, setFiltered] = useState<Task[]>([]);

  const [categoryMap, setCategoryMap] = useState<CategoryMap>({});

// Firestore 読み込み（API経由）
useEffect(() => {
  async function load() {
    // ▼ タスク取得（API Route）
    const resTasks = await fetch(`/api/tasks/list?projectId=${projectId}`);
    const jsonTasks = (await resTasks.json()) as TasksResponse;

    console.log("🔥 page.tsx loaded tasks =", jsonTasks.tasks);

    setTasks(jsonTasks.tasks);
    setFiltered(jsonTasks.tasks);

    // ▼ カテゴリのロード
    const res = await fetch("/api/categories/list");
    const json = (await res.json()) as CategoriesResponse;
    console.log("🔥 page.tsx json.map =", json.map);

    setCategoryMap(json.map);
  }

  load();
}, [projectId]);



  // ----------------------------
  // フィルター処理
  // ----------------------------
  function applyFilter({ stage, parent, child }: TaskFilterValues) {
    let result = [...tasks];

    if (stage) {
      result = result.filter((t) => t.stage === stage);
    }
    if (parent) {
      result = result.filter((t) => t.category_parent === parent);
    }
    if (child) {
      result = result.filter((t) => t.category_child === child);
    }

    setFiltered(result);
  }

  return (
    <div className="p-6 max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">タスク一覧</h1>

      {/* ▼ フィルター UI */}
      <TaskFilters categoryMap={categoryMap} onFilter={applyFilter} />

      {/* ▼ タスク一覧 */}
      <div className="space-y-3">
        {filtered.map((task) => (
          <div key={task.id} className="flex items-center gap-3 border p-3 rounded">
            <div className={`w-2 h-full rounded ${task.done ? "bg-gray-400" : "bg-blue-600"}`}></div>

            <div className="flex-1">
              <div className={task.done ? "line-through text-gray-600" : ""}>
                {task.title}
              </div>
              <div className="text-xs text-gray-500">
                {task.stage} / {task.category_parent} / {task.category_child}
              </div>
            </div>
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
