"use client";

import { use } from "react";
import { RehearsalSectionNavigation } from "../RehearsalSectionNavigation";
import { RehearsalClient } from "./RehearsalClient";

export default function RehearsalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <>
    <RehearsalSectionNavigation projectId={projectId} />
    <RehearsalClient projectId={projectId} />
  </>;
}
