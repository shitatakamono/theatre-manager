import Link from "next/link";
import { getProjectPerformanceData } from "@/lib/firestore";
import { PerformanceInfoClient } from "./PerformanceInfoClient";

type PerformanceInfoPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function PerformanceInfoPage({
  params,
}: PerformanceInfoPageProps) {
  const { projectId } = await params;
  const project = await getProjectPerformanceData(projectId);

  if (!project) {
    return (
      <main className="p-6">
        <h1 className="mb-2 text-xl font-bold">公演が見つかりません。</h1>
        <Link className="text-blue-700 underline" href="/">
          公演一覧に戻る
        </Link>
      </main>
    );
  }

  return <PerformanceInfoClient project={project} />;
}
