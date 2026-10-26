import { redirect } from "next/navigation";
import { getLegacyParticipantRedirectPath } from "@/lib/project-navigation";

export default async function LegacyParticipantsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(getLegacyParticipantRedirectPath(projectId));
}
