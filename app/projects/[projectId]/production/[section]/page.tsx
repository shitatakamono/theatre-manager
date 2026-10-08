import Link from "next/link";
import { getProject } from "@/lib/firestore";

type ProductionSectionPageProps = {
  params: Promise<{ projectId: string; section: string }>;
};

const sectionNames: Record<string, string> = {
  venue: "会場",
  flyer: "チラシ・ポスター",
  web: "Web・SNS",
  tickets: "チケット",
  reception: "当日受付",
  accounting: "会計",
};

export default async function ProductionSectionPage({
  params,
}: ProductionSectionPageProps) {
  const { projectId, section } = await params;
  const project = await getProject(projectId);
  const sectionName = sectionNames[section];

  if (!project || !sectionName) {
    return (
      <main className="grid min-h-screen place-content-center gap-3 p-6 text-center">
        <h1 className="text-xl font-bold">ページが見つかりません。</h1>
        <Link
          className="font-bold text-emerald-800 underline"
          href={project ? `/projects/${projectId}` : "/"}
        >
          {project ? "公演トップに戻る" : "公演一覧に戻る"}
        </Link>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-content-center gap-4 bg-stone-50 p-6 text-center text-stone-900">
      <p className="text-xs font-bold tracking-widest text-emerald-800">
        PRODUCTION
      </p>
      <h1 className="text-3xl font-bold">{sectionName}</h1>
      <p className="text-sm text-stone-600">
        この制作管理画面は現在準備中です。
      </p>
      <Link
        className="mx-auto mt-2 rounded-md bg-emerald-800 px-4 py-2 text-sm font-bold text-white"
        href={`/projects/${projectId}`}
      >
        公演トップに戻る
      </Link>
    </main>
  );
}
