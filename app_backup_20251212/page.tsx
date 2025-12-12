// src/app/page.tsx
import { getProjects } from "@/lib/firestore";


export default async function Page() {
  const projects = await getProjects();

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">公演一覧</h1>

      {projects.length === 0 && (
        <p className="text-gray-500">まだ公演がありません。</p>
      )}

      <ul className="space-y-2">
        {projects.map((p) => (
          <li
            key={p.id}
            className="border p-4 rounded-md hover:bg-gray-50 transition"
          >
            {p.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
