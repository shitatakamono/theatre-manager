"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { getProjectPerformanceData } from "@/lib/firestore";
import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { PerformanceInfoClient } from "./PerformanceInfoClient";

type PerformanceInfoPageProps = {
  params: Promise<{ projectId: string }>;
};

export default function PerformanceInfoPage({
  params,
}: PerformanceInfoPageProps) {
  const { projectId } = use(params);
  const [project, setProject] = useState<ProjectPerformanceRecord | null>();

  useEffect(() => {
    void getProjectPerformanceData(projectId).then(setProject);
  }, [projectId]);

  if (project === undefined) return <main className="p-6">読み込み中…</main>;

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
