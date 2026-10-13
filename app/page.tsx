import { getProjects } from "@/lib/firestore";
import { ProjectListClient } from "./ProjectListClient";

export default async function Page() {
  const projects = await getProjects();
  return (
    <ProjectListClient
      initialProjects={projects.map((project) => ({
        id: project.id,
        title: project.title || "名称未設定",
      }))}
    />
  );
}
