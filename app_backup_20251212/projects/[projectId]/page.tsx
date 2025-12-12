import { getProject } from "@/lib/firestore";

export default async function ProjectPage({ params }: { params: { projectId: string } }) {
  const project = await getProject(params.projectId);

  if (!project) {
    return <div>公演が見つかりません。</div>;
  }

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>{project.title}</h1>
      <p>プロジェクト期間：{project.start_date ?? "未設定"} ～ {project.end_date ?? "未設定"}</p>
      <p>公演期間：{project.show_start_date ?? "未設定"} ～ {project.show_end_date ?? "未設定"}</p>
    </div>
  );
}
