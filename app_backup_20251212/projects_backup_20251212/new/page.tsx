"use client";

import { useState } from "react";
import { addProject } from "@/lib/firestore";
import { useRouter } from "next/navigation";

export default function NewProjectPage() {
  const router = useRouter();

  // 入力項目
  const [title, setTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [showStart, setShowStart] = useState("");
  const [showEnd, setShowEnd] = useState("");

async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();

  const id = await addProject({
    title,
    start_date: start,
    end_date: end,
    show_start_date: showStart,
    show_end_date: showEnd,
  });

  console.log("生成されたID:", id);

  router.push(`/projects/${id}`);
}


  return (
    <div className="min-h-screen bg-zinc-50 p-8 text-black">
      <h1 className="text-2xl font-bold mb-6">公演作成</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
        
        {/* 公演タイトル */}
        <div>
          <label className="block mb-1">公演タイトル</label>
          <input
            type="text"
            className="w-full border p-2 rounded"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        {/* プロジェクト期間：開始 */}
        <div>
          <label className="block mb-1">プロジェクト開始日（稽古開始など）</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>

        {/* プロジェクト期間：終了 */}
        <div>
          <label className="block mb-1">プロジェクト終了日（反省会・返却まで）</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>

        {/* 公演期間：開始 */}
        <div>
          <label className="block mb-1">公演期間開始日（小屋入りなど）</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={showStart}
            onChange={(e) => setShowStart(e.target.value)}
          />
        </div>

        {/* 公演期間：終了 */}
        <div>
          <label className="block mb-1">公演期間終了日（撤収日など）</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={showEnd}
            onChange={(e) => setShowEnd(e.target.value)}
          />
        </div>

        {/* ボタン */}
        <button
          type="submit"
          className="bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
        >
          作成する
        </button>

      </form>
    </div>
  );
}
