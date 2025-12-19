"use client";

import { useEffect, useState } from "react";
import {
  getCategories,
  toCategoryMap
} from "@/lib/firestore";

export default function CategoryManagerPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const list = await getCategories();
      setCategories(list);
      setLoaded(true);
    })();
  }, []);

  if (!loaded) return <div className="p-6">読み込み中...</div>;

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold mb-4">カテゴリ管理</h1>

      {/* ▼ カテゴリ一覧 */}
      {categories.map((cat) => (
        <div key={cat.id} className="p-4 border bg-white rounded shadow-sm">
          <div className="font-bold text-lg">{cat.name}</div>

          <ul className="ml-4 mt-2 text-sm">
            {cat.children?.map((c: string, idx: number) => (
              <li key={idx}>・{c}</li>
            ))}
          </ul>

          {/* 子カテゴリ追加フォーム */}
          <ChildAddForm parentId={cat.id} />
        </div>
      ))}

      {/* 親カテゴリ追加 */}
      <ParentAddForm />
    </div>
  );
}

// ------------------------------
// ▼ 子カテゴリ追加フォーム
// ------------------------------
function ChildAddForm({ parentId }: { parentId: string }) {
  const [value, setValue] = useState("");

  async function submit() {
    if (!value.trim()) return;

    // Firestore へ追加
    await fetch("/api/categories/add-child", {
      method: "POST",
      body: JSON.stringify({ parentId, name: value }),
    });

    location.reload();
  }

  return (
    <div className="mt-3 flex gap-2">
      <input
        type="text"
        placeholder="子カテゴリ名"
        className="border p-1 rounded flex-1"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button onClick={submit} className="bg-blue-600 text-white px-3 rounded">
        追加
      </button>
    </div>
  );
}

// ------------------------------
// ▼ 親カテゴリ追加フォーム
// ------------------------------
function ParentAddForm() {
  const [value, setValue] = useState("");

  async function submit() {
    if (!value.trim()) return;

    await fetch("/api/categories/add-parent", {
      method: "POST",
      body: JSON.stringify({ name: value }),
    });

    location.reload();
  }

  return (
    <div className="p-4 border bg-white rounded shadow-sm">
      <h2 className="font-bold mb-2">新しい親カテゴリを追加</h2>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="カテゴリ名"
          className="border p-2 rounded flex-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button onClick={submit} className="bg-green-600 text-white px-4 rounded">
          追加
        </button>
      </div>
    </div>
  );
}
