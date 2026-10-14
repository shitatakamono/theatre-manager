import { ProjectAccessBoundary } from "./ProjectAccess";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectAccessBoundary projectId={projectId}>{children}</ProjectAccessBoundary>;
}
