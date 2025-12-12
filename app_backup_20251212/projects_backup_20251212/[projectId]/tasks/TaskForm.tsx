"use client";

import { useState, useEffect } from "react";

export default function TaskForm({
  CATEGORY_MAP,
  onSubmit,
}: {
  CATEGORY_MAP: any;
  onSubmit: any;
}) {
  const [parent, setParent] = useState("舞台監督");
  const [children, setChildren] = useState<string[]>([]);

  useEffect(() => {
    setChildren(CATEGORY_MAP[parent] || []);
  }, [parent]);

  return (
    <form
      action={onSubmit}
      className="flex flex-col gap-3 bg-white shadow p-4 rounded-xl border"
    >
      {/* タスク名 */}
      <input
        type="text"
        name="title"
        placeholder="タスク名を入力"
        className="border p-2 rounded-lg text-base"
        required
      />

      {/* 時間カテゴリ */}
      <select name="stage" className="border p-2 rounded-lg" required>
        <option value="前期">前期</option>
        <option value="中期">中期</option>
        <option value="後期">後期</option>
        <option value="当日">当日</option>
      </select>

      {/* 親カテゴリ */}
      <select
        name="category_parent"
        className="border p-2 rounded-lg"
        value={parent}
        onChange={(e) => setParent(e.target.value)}
        required
      >
        {Object.keys(CATEGORY_MAP).map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      {/* 子カテゴリ */}
      <select name="category_child" className="border p-2 rounded-lg">
        {children.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      {/* ▼ 期限（Today画面用） */}
<input
  type="date"
  name="due_date"
  className="border p-2 rounded-lg"
/>


      <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-base hover:bg-blue-700">
        追加
      </button>
    </form>
  );
}
