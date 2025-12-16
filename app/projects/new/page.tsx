"use client";

import { useState } from "react";
import { addProject } from "@/lib/firestore";
import { useRouter } from "next/navigation";

export default function NewProjectPage() {
  const router = useRouter();

  const [title, setTitle] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const id = await addProject({ title });
    router.push(`/projects/${id}`);
  }

  return (
    <div className="min-h-screen p-6">
      <h1 className="text-2xl font-bold mb-4">公演作成</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4 max-w-md">
        <input
          type="text"
          className="border p-2 rounded"
          placeholder="公演タイトルを入力"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />

        <button
          type="submit"
          className="bg-blue-600 text-white px-4 py-2 rounded"
        >
          作成する
        </button>
      </form>
    </div>
  );
}
