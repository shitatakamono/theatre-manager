"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useAuth } from "@/app/AuthProvider";
import type { ProjectMember, ProjectRole } from "@/lib/auth";
import type { InviteRole, ProjectMemberInvite } from "@/lib/member-invites";
import { requestMemberInviteEmail } from "@/lib/member-invite-email-client";
import {
  createProjectMemberInvite, getProject, getProjectMemberInvites, getProjectMembers,
  removeProjectMember, revokeProjectMemberInvite, updateProjectMemberRole,
} from "@/lib/firestore";
import { useProjectAccess } from "../ProjectAccess";
import { getSystemUserStatus, SYSTEM_ROLE_LABELS } from "@/lib/management-view";
import styles from "./members.module.css";

const roleLabels = SYSTEM_ROLE_LABELS;

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
  const [sendingInviteId, setSendingInviteId] = useState("");

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
    }).catch(() => { if (active) setError("システム利用者を読み込めませんでした"); })
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
    if (!canManageMembers || member.uid === profile?.uid || !confirm(`${memberName} のシステム利用を解除しますか？`)) return;
    setError(""); setMessage("");
    try {
      await removeProjectMember(projectId, member.uid);
      setMembers((current) => current.filter((item) => item.uid !== member.uid));
    } catch { setError("システム利用を解除できませんでした"); }
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageMembers || !profile || inviting) return;
    setInviting(true); setError(""); setMessage("");
    try {
      const created = await createProjectMemberInvite({ projectId, projectName, email: inviteEmail, role: inviteRole, invitedBy: profile });
      setInvites((current) => [created, ...current.filter((item) => item.id !== created.id)]);
      setInviteEmail("");
      try {
        await requestMemberInviteEmail(projectId, created.email);
        setInvites((current) => current.map((item) => item.id === created.id
          ? { ...item, emailStatus: "sent", emailLastError: null }
          : item));
        setMessage(`${created.email} に招待メールを送信しました`);
      } catch {
        setInvites((current) => current.map((item) => item.id === created.id
          ? { ...item, emailStatus: "failed" }
          : item));
        setMessage("招待は登録しましたが、メール送信に失敗しました。招待一覧から再送できます。");
      }
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : "招待を登録できませんでした");
    } finally { setInviting(false); }
  }

  async function resend(inviteItem: ProjectMemberInvite) {
    if (!canManageMembers || inviteItem.status !== "pending" || sendingInviteId) return;
    setSendingInviteId(inviteItem.id); setError(""); setMessage("");
    try {
      await requestMemberInviteEmail(projectId, inviteItem.email);
      setInvites((current) => current.map((item) => item.id === inviteItem.id
        ? { ...item, emailStatus: "sent", emailLastError: null }
        : item));
      setMessage(`${inviteItem.email} に招待メールを再送しました`);
    } catch (sendError) {
      const errorMessage = sendError instanceof Error ? sendError.message : "招待メールを再送できませんでした";
      setError(errorMessage);
      const failed = (sendError as Error & { emailStatus?: string }).emailStatus === "failed";
      if (failed) {
        setInvites((current) => current.map((item) => item.id === inviteItem.id
          ? { ...item, emailStatus: "failed" }
          : item));
      }
    } finally { setSendingInviteId(""); }
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

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href={`/projects/${projectId}`}>← 公演トップ</Link><p>SYSTEM USERS</p><h1>システム利用者</h1><span>SeisakuBoardへログインし、この公演を閲覧・編集するアカウントです。</span></div>
      <strong>{members.length}名</strong>
    </header>
    {legacyAccess && <p className={styles.notice}>この公演は移行前データです。Owner bootstrap後に利用者管理を利用できます。</p>}
    {!canManageMembers && !legacyAccess && <p className={styles.notice}>利用者一覧は閲覧のみです。Role変更・削除・招待管理はOwnerのみ可能です。</p>}
    {error && <p className={`${styles.notice} ${styles.error}`} role="alert">{error}</p>}
    {message && <p className={`${styles.notice} ${styles.success}`} role="status">{message}</p>}

    {loading ? <p className={styles.state}>読み込み中…</p> : <section className={styles.section}><div className={styles.sectionHeading}><h2>利用中のアカウント</h2><span>キャスト・スタッフ・出欠対象者とは別に管理されます。</span></div><ul className={styles.userList}>{members.map((member) => {
      const primary = member.displayName || member.email || member.uid;
      const secondary = member.displayName ? (member.email || member.uid) : member.email ? member.uid : "";
      return <li className={styles.userRow} key={member.uid}>
        <div className={styles.identity}><strong>{primary}</strong>{secondary && <span>{secondary}</span>}</div>
        <div className={styles.userMeta}><small>状態</small><span className={styles.status}>{getSystemUserStatus()}</span></div>
        <div className={styles.roleControl}><small>役割</small>{canManageMembers ? <select value={member.role} disabled={member.uid === profile?.uid} onChange={(event) => void changeRole(member, event.target.value as ProjectRole)}>{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select> : <span className={styles.roleBadge}>{roleLabels[member.role]}</span>}</div>
        {canManageMembers && member.uid !== profile?.uid && <button className={styles.removeButton} onClick={() => void remove(member)}>利用解除</button>}
      </li>;
    })}</ul></section>}

    {canManageMembers && !legacyAccess ? <>
      <section className={styles.inviteSection}>
        <div className={styles.sectionHeading}><h2>システム利用者を招待</h2><span>招待先のGoogleアカウントでログインすると自動参加します。</span></div>
        <form className={styles.inviteForm} onSubmit={(event) => void invite(event)}>
          <label><span>メールアドレス</span><input type="email" required maxLength={254} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} /></label>
          <label><span>役割</span><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as InviteRole)}><option value="editor">Editor</option><option value="viewer">Viewer</option></select></label>
          <button type="submit" disabled={inviting}>{inviting ? "登録中…" : "招待する"}</button>
        </form>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}><h2>招待中</h2></div>
        {pendingInvites.length === 0 ? <p className={styles.state}>招待中の利用者はいません。</p> : <ul className={styles.inviteList}>{pendingInvites.map((inviteItem) => <li key={inviteItem.id}>
          <div><strong>{inviteItem.email}</strong><span>{roleLabels[inviteItem.role]}・招待中</span><small data-failed={inviteItem.emailStatus === "failed" || undefined}>{inviteItem.emailStatus === "sent" ? "メール送信済み" : inviteItem.emailStatus === "failed" ? "メール送信失敗" : "メール未送信"}</small></div>
          <div className={styles.inviteActions}><button disabled={Boolean(sendingInviteId)} onClick={() => void resend(inviteItem)}>{sendingInviteId === inviteItem.id ? "送信中…" : "再送"}</button><button data-danger onClick={() => void revoke(inviteItem)}>招待取消</button></div>
        </li>)}</ul>}
      </section>
    </> : null}
  </main>;
}
