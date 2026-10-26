"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { ProjectMember } from "@/lib/auth";
import { getProjectMembers, getProjectPerformanceData, type ProjectPerformanceRecord } from "@/lib/firestore";
import { getProjectPeopleWithFallback, type ProjectPerson } from "@/lib/people";
import { PeopleManagementClient } from "./PeopleManagementClient";

export default function PeopleManagementPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [project, setProject] = useState<ProjectPerformanceRecord | null>();
  const [people, setPeople] = useState<ProjectPerson[]>();
  const [members, setMembers] = useState<ProjectMember[]>();

  useEffect(() => {
    void Promise.all([
      getProjectPerformanceData(projectId),
      getProjectPeopleWithFallback(projectId),
      getProjectMembers(projectId),
    ]).then(([nextProject, nextPeople, nextMembers]) => {
      setProject(nextProject);
      setPeople(nextPeople);
      setMembers(nextMembers);
    });
  }, [projectId]);

  if (project === undefined || people === undefined || members === undefined) {
    return <main className="p-6">読み込み中…</main>;
  }
  if (!project) {
    return <main className="p-6"><h1 className="mb-2 text-xl font-bold">公演が見つかりません。</h1><Link className="underline" href="/">公演一覧へ戻る</Link></main>;
  }
  return <PeopleManagementClient project={project} initialPeople={people} members={members} />;
}
