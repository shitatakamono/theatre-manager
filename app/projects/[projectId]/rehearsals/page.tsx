"use client";

import { use } from "react";
import { RehearsalClient } from "./RehearsalClient";

export default function RehearsalsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <RehearsalClient projectId={projectId} />;
}
