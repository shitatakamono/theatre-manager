import { ProjectAccessBoundary } from "./ProjectAccess";
import { FeedbackLink } from "./FeedbackLink";
import { ProjectNavigation } from "./ProjectNavigation";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <ProjectAccessBoundary projectId={projectId}>
      <ProjectNavigation projectId={projectId} />
      {children}
      <FeedbackLink projectId={projectId} />
    </ProjectAccessBoundary>
  );
}
