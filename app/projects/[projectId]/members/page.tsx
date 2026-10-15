"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useAuth } from "@/app/AuthProvider";
import type { ProjectMember, ProjectRole } from "@/lib/auth";
import type { InviteRole, ProjectMemberInvite } from "@/lib/member-invites";
import {
  createProjectMemberInvite, getProject, getProjectMemberInvites, getProjectMembers,
  removeProjectMember, revokeProjectMemberInvite, updateProjectMemberRole,
} from "@/lib/firestore";
import { useProjectAccess } from "../ProjectAccess";

const roleLabels: Record<ProjectRole, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

export default function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { profile } = useAuth();
  const { canManageMembers, legacyAccess } = useProjectAccess();
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [invites, setInvites] = useState<ProjectMemberInvite[]>([]);
  const [projectName, setProjectName] = useState("名称未設定の公演");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("editor");
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getProjectMembers(projectId), getProject(projectId),
      canManageMembers ? getProjectMemberInvites(projectId) : Promise.resolve([]),
    ]).then(([memberItems, project, inviteItems]) => {
      if (!active) return;
      setMembers(memberItems);
      setProjectName(project?.title || "名称未設定の公演");
      setInvites(inviteItems);
    }).catch(() => { if (active) setError("メンバー情報を読み込めませんでした"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [canManageMembers, projectId]);

  async function changeRole(member: ProjectMember, role: ProjectRole) {
    if (!canManageMembers || member.uid === profile?.uid) return;
    setError(""); setMessage("");
    try {
      await updateProjectMemberRole(projectId, member, role);
      setMembers((current) => current.map((item) => item.uid === member.uid ? { ...item, role } : item));
    } catch { setError("Roleを変更できませんでした"); }
  }

  async function remove(member: ProjectMember) {
    const memberName = member.displayName || member.email || member.uid;
    if (!canManageMembers || member.uid === profile?.uid || !confirm(`${memberName} をメンバーから削除しますか？`)) return;
    setError(""); setMessage("");
    try {
      await removeProjectMember(projectId, member.uid);
      setMembers((current) => current.filter((item) => item.uid !== member.uid));
    } catch { setError("メンバーを削除できませんでした"); }
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageMembers || !profile || inviting) return;
    setInviting(true); setError(""); setMessage("");
    try {
      const created = await createProjectMemberInvite({ projectId, projectName, email: inviteEmail, role: inviteRole, invitedBy: profile });
      setInvites((current) => [created, ...current]);
      setInviteEmail("");
      setMessage(`${created.email} を${roleLabels[created.role]}として招待しました。このメールアドレスのGoogleアカウントでSeisakuBoardにログインすると参加できます。`);
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "招待を登録できませんでした");
    } finally { setInviting(false); }
  }

  async function revoke(inviteItem: ProjectMemberInvite) {
    if (!canManageMembers || inviteItem.status !== "pending" || !confirm(`${inviteItem.email} への招待を取り消しますか？`)) return;
    setError(""); setMessage("");
    try {
      await revokeProjectMemberInvite(projectId, inviteItem.email);
      setInvites((current) => current.map((item) => item.id === inviteItem.id ? { ...item, status: "revoked" } : item));
      setMessage("招待を取り消しました");
    } catch { setError("招待を取り消せませんでした"); }
  }

  const pendingInvites = invites.filter((inviteItem) => inviteItem.status === "pending");

  return <main className="mx-auto min-h-screen max-w-3xl space-y-5 bg-gray-50 p-6 text-gray-900">
    <Link className="text-sm font-bold text-emerald-800 underline" href={`/projects/${projectId}`}>← 公演トップへ戻る</Link>
    <header><p className="text-xs font-bold tracking-widest text-gray-500">PROJECT TEAM</p><h1 className="text-3xl font-bold">メンバー</h1></header>
    {legacyAccess && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm">この公演は移行前データです。Owner bootstrap後にメンバー管理を利用できます。</p>}
    {!canManageMembers && !legacyAccess && <p className="rounded border bg-white p-3 text-sm text-gray-600">メンバー一覧は閲覧のみです。Role変更・削除・招待管理はOwnerのみ可能です。</p>}
    {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
    {message && <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800" role="status">{message}</p>}

    {loading ? <p>読み込み中…</p> : <section className="space-y-3"><h2 className="font-bold">参加中</h2><ul className="space-y-2">{members.map((member) => {
      const primary = member.displayName || member.email || member.uid;
      const secondary = member.displayName ? (member.email || member.uid) : member.email ? member.uid : "";
      return <li className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4" key={member.uid}>
        <div className="min-w-0 flex-1"><strong className="block truncate">{primary}</strong>{secondary && <span className="block truncate text-xs text-gray-500">{secondary}</span>}</div>
        {canManageMembers ? <select className="rounded border p-2" value={member.role} disabled={member.uid === profile?.uid} onChange={(event) => void changeRole(member, event.target.value as ProjectRole)}>{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select> : <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold">{roleLabels[member.role]}</span>}
        {canManageMembers && member.uid !== profile?.uid && <button className="min-h-10 rounded border border-red-300 px-3 text-sm font-bold text-red-700" onClick={() => void remove(member)}>削除</button>}
      </li>;
    })}</ul></section>}

    {canManageMembers && !legacyAccess ? <>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="font-bold">新しいメンバーを招待</h2>
        <p className="mt-1 text-sm text-gray-600">招待メールは送信されません。このメールアドレスのGoogleアカウントでログインすると自動参加します。</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_130px_auto]" onSubmit={(event) => void invite(event)}>
          <label className="grid gap-1"><span className="text-xs font-bold">メールアドレス</span><input className="min-h-11 rounded border px-3" type="email" required maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          <label className="grid gap-1"><span className="text-xs font-bold">Role</span><select className="min-h-11 rounded border px-3" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label>
          <button className="min-h-11 self-end rounded bg-emerald-800 px-4 text-sm font-bold text-white disabled:opacity-60" type="submit" disabled={inviting}>{inviting ? "登録中…" : "招待する"}</button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">招待中</h2>
        {pendingInvites.length === 0 ? <p className="rounded border bg-white p-4 text-sm text-gray-500">招待中のメンバーはいません。</p> : <ul className="space-y-2">{pendingInvites.map((inviteItem) => <li className="flex flex-wrap items-center gap-3 rounded-lg border bg-white p-4" key={inviteItem.id}>
          <div className="min-w-0 flex-1"><strong className="block truncate">{inviteItem.email}</strong><span className="text-xs text-gray-500">{roleLabels[inviteItem.role]}・未参加</span></div>
          <button className="min-h-10 rounded border border-red-300 px-3 text-sm font-bold text-red-700" onClick={() => void revoke(inviteItem)}>招待を取り消す</button>
        </li>)}</ul>}
      </section>
    </> : null}
  </main>;
}
