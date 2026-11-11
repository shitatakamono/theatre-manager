"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useAuth } from "@/app/AuthProvider";
import type { ProjectMember, ProjectRole } from "@/lib/auth";
import {
  getProjectMembers, removeProjectMember, updateProjectMemberRole,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    void getProjectMembers(projectId).then((memberItems) => {
      if (!active) return;
      setMembers(memberItems);
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

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href={`/projects/${projectId}`}>← 公演トップ</Link><p>SYSTEM USERS</p><h1>システム利用者</h1><span>この公演でSeisakuBoardを利用できるアカウントと権限を確認します。</span></div>
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

    {canManageMembers && !legacyAccess && <p className={styles.notice}>新しく人を招待する場合は、関係者管理から対象者を選んでください。</p>}
  </main>;
}
