"use client";

import { use } from "react";
import { RehearsalPrintClient } from "./RehearsalPrintClient";

export default function RehearsalPrintPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  return <RehearsalPrintClient projectId={projectId} />;
}
