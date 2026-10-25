"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { getProjectPerformanceData } from "@/lib/firestore";
import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { getProjectPeopleWithFallback, type ProjectPerson } from "@/lib/people";
import { PerformanceInfoClient } from "./PerformanceInfoClient";

type PerformanceInfoPageProps = {
  params: Promise<{ projectId: string }>;
};

export default function PerformanceInfoPage({
  params,
}: PerformanceInfoPageProps) {
  const { projectId } = use(params);
  const [project, setProject] = useState<ProjectPerformanceRecord | null>();
  const [people, setPeople] = useState<ProjectPerson[]>();

  useEffect(() => {
    void Promise.all([
      getProjectPerformanceData(projectId),
      getProjectPeopleWithFallback(projectId),
    ]).then(([nextProject, nextPeople]) => {
      setProject(nextProject);
      setPeople(nextPeople);
    });
  }, [projectId]);

  if (project === undefined || people === undefined) return <main className="p-6">読み込み中…</main>;

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

  return <PerformanceInfoClient project={project} initialPeople={people} />;
}
