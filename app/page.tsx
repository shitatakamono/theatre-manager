// app/page.tsx
import { getProjects } from "@/lib/firestore";
import Link from "next/link";

export default async function Page() {
  const projects = await getProjects();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">公演一覧</h1>

      <div className="mb-4">
        <Link href="/projects/new">
          <button className="bg-blue-600 text-white px-4 py-2 rounded">
            公演を作成する
          </button>
        </Link>
      </div>

      {projects.length === 0 && (
        <p className="text-gray-500">まだ公演がありません。</p>
      )}

      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="border p-4 rounded hover:bg-gray-50 transition">
            <Link href={`/projects/${p.id}`} className="text-blue-600 underline">
              {p.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
