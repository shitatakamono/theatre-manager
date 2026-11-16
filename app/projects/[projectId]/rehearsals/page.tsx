import { RehearsalSectionNavigation } from "../RehearsalSectionNavigation";
import { RehearsalClient } from "./RehearsalClient";
import { parseRehearsalFilterTypes } from "@/lib/rehearsal-filter";

export default async function RehearsalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ types?: string | string[] }>;
}) {
  const [{ projectId }, query] = await Promise.all([params, searchParams]);
  const rawTypes = Array.isArray(query.types) ? query.types[0] : query.types;
  const initialSelectedTypes = parseRehearsalFilterTypes(rawTypes ?? null);
  return <>
    <RehearsalSectionNavigation projectId={projectId} />
    <RehearsalClient projectId={projectId} initialSelectedTypes={initialSelectedTypes} />
  </>;
}
