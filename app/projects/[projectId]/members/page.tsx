"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useAuth } from "@/app/AuthProvider";
import type { ProjectMember, ProjectRole } from "@/lib/auth";
import { getProjectMembers, removeProjectMember, updateProjectMemberRole } from "@/lib/firestore";
import { useProjectAccess } from "../ProjectAccess";

const roleLabels: Record<ProjectRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

export default function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { profile } = useAuth();
  const { canManageMembers, legacyAccess } = useProjectAccess();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void getProjectMembers(projectId).then(setMembers).catch(() => setError("メンバーを読み込めませんでした")).finally(() => setLoading(false));
  }, [projectId]);

  async function changeRole(member: ProjectMember, role: ProjectRole) {
    if (!canManageMembers || member.uid === profile?.uid) return;
    setError("");
    try { await updateProjectMemberRole(projectId, member, role); setMembers((current) => current.map((item) => item.uid === member.uid ? { ...item, role } : item)); }
    catch { setError("Roleを変更できませんでした"); }
  }

  async function remove(member: ProjectMember) {
    if (!canManageMembers || member.uid === profile?.uid || !confirm(`${member.displayName || member.email || member.uid} をメンバーから削除しますか？`)) return;
    setError("");
    try { await removeProjectMember(projectId, member.uid); setMembers((current) => current.filter((item) => item.uid !== member.uid)); }
    catch { setError("メンバーを削除できませんでした"); }
  }

  return <main className="mx-auto min-h-screen max-w-3xl space-y-5 bg-gray-50 p-6 text-gray-900">
    <Link className="text-sm font-bold text-emerald-800 underline" href={`/projects/${projectId}`}>← 公演トップへ戻る</Link>
    <header><p className="text-xs font-bold tracking-widest text-gray-500">PROJECT TEAM</p><h1 className="text-3xl font-bold">メンバー</h1></header>
    {legacyAccess && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">この公演は移行前データです。Owner bootstrap後にメンバー管理を利用できます。</p>}
    {!canManageMembers && !legacyAccess && <p className="rounded border bg-white p-3 text-sm text-gray-600">メンバー一覧は閲覧のみです。Role変更と削除はOwnerのみ可能です。</p>}
    {error && <p className="text-sm font-bold text-red-700" role="alert">{error}</p>}
    {loading ? <p>読み込み中…</p> : <ul className="space-y-2">{members.map((member) => <li className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4" key={member.uid}>
      <div className="min-w-0 flex-1"><strong className="block truncate">{member.displayName || "名前未設定"}</strong><span className="block truncate text-xs text-gray-500">{member.email || member.uid}</span></div>
      {canManageMembers ? <select className="rounded border p-2" value={member.role} disabled={member.uid === profile?.uid} onChange={(event) => void changeRole(member, event.target.value as ProjectRole)}>{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select> : <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold">{roleLabels[member.role]}</span>}
      {canManageMembers && member.uid !== profile?.uid && <button className="min-h-10 rounded border border-red-300 px-3 text-sm font-bold text-red-700" onClick={() => void remove(member)}>削除</button>}
    </li>)}</ul>}
    <section className="rounded-lg border bg-white p-4"><h2 className="font-bold">新しいメンバーの追加</h2><p className="mt-1 text-sm text-gray-600">Phase 1ではUIDを正本とする基盤のみ提供します。メール招待とUID検索は次工程で実装します。</p></section>
  </main>;
}
