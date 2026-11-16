import { parseRehearsalFilterTypes } from "@/lib/rehearsal-filter";
import { RehearsalPrintClient } from "./RehearsalPrintClient";

export default async function RehearsalPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ types?: string }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  return <RehearsalPrintClient
    projectId={projectId}
    selectedTypes={parseRehearsalFilterTypes(query.types)}
  />;
}
