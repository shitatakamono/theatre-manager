"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { getProject } from "@/lib/firestore";
import type { Project } from "@/lib/firestore";
import { pickPerformanceData } from "@/lib/performance";
import { AccountingManagementClient } from "./AccountingManagementClient";
import { FlyerManagementClient } from "./FlyerManagementClient";
import { ReceptionManagementClient } from "./ReceptionManagementClient";
import { TicketManagementClient } from "./TicketManagementClient";
import { VenueManagementClient } from "./VenueManagementClient";
import { WebManagementClient } from "./WebManagementClient";

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

export default function ProductionSectionPage({
  params,
}: ProductionSectionPageProps) {
  const { projectId, section } = use(params);
  const [project, setProject] = useState<(Project & { id: string }) | null>();

  useEffect(() => {
    void getProject(projectId).then(setProject);
  }, [projectId]);

  if (project === undefined) return <main className="grid min-h-screen place-content-center p-6">読み込み中…</main>;
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

  const projectRecord = {
    id: project.id,
    legacyTitle: project.title,
    startDate: project.start_date,
    endDate: project.end_date,
    showStartDate: project.show_start_date,
    showEndDate: project.show_end_date,
    performanceInfoUpdatedAt: project.performanceInfoUpdatedAt?.toDate().toISOString(),
    data: pickPerformanceData(project),
    revisions: project.revisions,
  };

  switch (section) {
    case "venue":
      return (
        <VenueManagementClient
          project={{
            ...projectRecord,
            venueManagement: project.production?.venue,
            receptionManagement: project.production?.reception,
          }}
        />
      );
    case "flyer":
      return (
        <FlyerManagementClient
          project={projectRecord}
          management={project.production?.flyer}
        />
      );
    case "web":
      return (
        <WebManagementClient
          project={projectRecord}
          management={project.production?.web}
        />
      );
    case "tickets":
      return (
        <TicketManagementClient
          project={projectRecord}
          management={project.production?.tickets}
        />
      );
    case "reception":
      return (
        <ReceptionManagementClient
          project={projectRecord}
          management={project.production?.reception}
          accountingManagement={project.production?.accounting}
        />
      );
    case "accounting":
      return (
        <AccountingManagementClient
          project={projectRecord}
          management={project.production?.accounting}
        />
      );
  }
}
