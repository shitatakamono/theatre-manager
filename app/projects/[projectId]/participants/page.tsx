"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import type { ProjectMember } from "@/lib/auth";
import { getProjectMembers } from "@/lib/firestore";
import { getProjectPeopleWithFallback, type ProjectPerson } from "@/lib/people";
import { SPECIAL_PRACTICE_LABELS } from "@/lib/participants";
import styles from "./participants.module.css";

function memberLabel(member: ProjectMember): string {
  return member.displayName || member.email || member.uid;
}

export default function ParticipantsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const [participants, setParticipants] = useState<ProjectPerson[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [participantItems, memberItems] = await Promise.all([
        getProjectPeopleWithFallback(projectId),
        getProjectMembers(projectId),
      ]);
      setParticipants(participantItems);
      setMembers(memberItems.sort((left, right) => memberLabel(left).localeCompare(memberLabel(right), "ja")));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "参加者情報を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([getProjectPeopleWithFallback(projectId), getProjectMembers(projectId)])
      .then(([participantItems, memberItems]) => {
        if (!active) return;
        setParticipants(participantItems);
        setMembers(memberItems.sort((left, right) => memberLabel(left).localeCompare(memberLabel(right), "ja")));
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "参加者情報を読み込めませんでした");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const visibleParticipants = useMemo(
    () => participants.filter((participant) => showInactive || participant.active),
    [participants, showInactive]
  );
  const memberByUid = useMemo(() => new Map(members.map((member) => [member.uid, member])), [members]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href={`/projects/${projectId}`}>← 公演トップ</Link>
          <p>PARTICIPANTS</p>
          <h1>参加者管理</h1>
          <span>この画面は確認用です</span>
        </div>
      </header>

      <section className={styles.readOnlyNotice} aria-label="編集先の案内">
        <p>関係者情報の追加・編集は「関係者管理」から行ってください。</p>
        <Link href={`/projects/${projectId}/people`}>関係者管理を開く</Link>
      </section>

      <div className={styles.toolbar}>
        <p>現在の参加者 <strong>{participants.filter((participant) => participant.active).length}名</strong></p>
        <label><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />終了した参加者も表示</label>
      </div>

      {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={() => void load()}>再読み込み</button></p>}
      {loading ? <p className={styles.empty}>読み込み中…</p> : visibleParticipants.length === 0 ? <p className={styles.empty}>表示する参加者はいません。</p> : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>氏名</th><th>出欠対象</th><th>特別稽古</th><th>システム利用者との連携</th><th>公開備考</th><th>状態</th><th>操作</th></tr></thead>
            <tbody>{visibleParticipants.map((participant) => {
              const linkedMember = participant.linkedUserUid ? memberByUid.get(participant.linkedUserUid) : undefined;
              return <tr data-inactive={!participant.active} key={participant.id}>
                <td data-label="氏名"><strong>{participant.displayName}</strong></td>
                <td data-label="出欠対象">{participant.attendanceTarget ? "対象" : "対象外"}</td>
                <td data-label="特別稽古">{SPECIAL_PRACTICE_LABELS[participant.specialPractice]}</td>
                <td data-label="システム利用者との連携">{participant.linkedUserUid ? `連携済：${linkedMember ? memberLabel(linkedMember) : participant.linkedUserUid}` : "未連携"}</td>
                <td data-label="公開備考" className={styles.note}>{participant.publicNote || "—"}</td>
                <td data-label="状態"><span className={participant.active ? styles.active : styles.inactive}>{participant.active ? "参加中" : "終了"}</span></td>
                <td data-label="操作">—</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
