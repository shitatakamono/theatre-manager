"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import type { ProjectMember } from "@/lib/auth";
import { getProjectMembers } from "@/lib/firestore";
import {
  EMPTY_PARTICIPANT_INPUT,
  SPECIAL_PRACTICE_LABELS,
  SPECIAL_PRACTICE_OPTIONS,
  createProjectParticipant,
  getProjectParticipants,
  updateProjectParticipant,
  type Participant,
  type ParticipantInput,
} from "@/lib/participants";
import { useProjectAccess } from "../ProjectAccess";
import styles from "./participants.module.css";

function memberLabel(member: ProjectMember): string {
  return member.displayName || member.email || member.uid;
}

export default function ParticipantsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { canEdit, actor } = useProjectAccess();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Participant | null | undefined>(undefined);
  const [draft, setDraft] = useState<ParticipantInput>(EMPTY_PARTICIPANT_INPUT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const [participantItems, memberItems] = await Promise.all([
        getProjectParticipants(projectId),
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
    void Promise.all([getProjectParticipants(projectId), getProjectMembers(projectId)])
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
  const linkedParticipantByUid = useMemo(() => new Map(
    participants.flatMap((participant) => participant.linkedUserUid ? [[participant.linkedUserUid, participant.id] as const] : [])
  ), [participants]);
  const memberByUid = useMemo(() => new Map(members.map((member) => [member.uid, member])), [members]);

  function openCreate() {
    setEditing(null);
    setDraft({ ...EMPTY_PARTICIPANT_INPUT });
    setFormError("");
  }

  function openEdit(participant: Participant) {
    setEditing(participant);
    setDraft({
      displayName: participant.displayName,
      specialPractice: participant.specialPractice,
      linkedUserUid: participant.linkedUserUid,
      publicNote: participant.publicNote,
      active: participant.active,
    });
    setFormError("");
  }

  function closeEditor() {
    if (!saving) {
      setEditing(undefined);
      setFormError("");
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true);
    setFormError("");
    setNotice("");
    try {
      if (editing) {
        await updateProjectParticipant(projectId, editing.id, draft, actor);
        setNotice(draft.active || !editing.active ? "参加者情報を更新しました" : "参加者を終了しました");
      } else {
        await createProjectParticipant(projectId, draft, actor);
        setNotice("参加者を追加しました");
      }
      setEditing(undefined);
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "参加者情報を保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href={`/projects/${projectId}`}>← 公演トップ</Link>
          <p>PARTICIPANTS</p>
          <h1>参加者管理</h1>
        </div>
        {canEdit && <button type="button" onClick={openCreate}>参加者を追加</button>}
      </header>

      <div className={styles.toolbar}>
        <p>現在の参加者 <strong>{participants.filter((participant) => participant.active).length}名</strong></p>
        <label><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />終了した参加者も表示</label>
      </div>

      {notice && <p className={styles.success} role="status">{notice}</p>}
      {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={() => void load()}>再読み込み</button></p>}
      {loading ? <p className={styles.empty}>読み込み中…</p> : visibleParticipants.length === 0 ? <p className={styles.empty}>表示する参加者はいません。</p> : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead><tr><th>氏名</th><th>特別稽古</th><th>アカウント</th><th>状態</th><th>公開備考</th>{canEdit && <th>操作</th>}</tr></thead>
            <tbody>{visibleParticipants.map((participant) => {
              const linkedMember = participant.linkedUserUid ? memberByUid.get(participant.linkedUserUid) : undefined;
              return <tr data-inactive={!participant.active} key={participant.id}>
                <td data-label="氏名"><strong>{participant.displayName}</strong></td>
                <td data-label="特別稽古">{SPECIAL_PRACTICE_LABELS[participant.specialPractice]}</td>
                <td data-label="アカウント">{participant.linkedUserUid ? linkedMember ? memberLabel(linkedMember) : "紐付け済み（メンバー情報なし）" : "未紐付け"}</td>
                <td data-label="状態"><span className={participant.active ? styles.active : styles.inactive}>{participant.active ? "参加中" : "終了"}</span></td>
                <td data-label="公開備考" className={styles.note}>{participant.publicNote || "—"}</td>
                {canEdit && <td data-label="操作"><button className={styles.editButton} type="button" onClick={() => openEdit(participant)}>編集</button></td>}
              </tr>;
            })}</tbody>
          </table>
        </div>
      )}

      {editing !== undefined && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeEditor(); }}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="participant-editor-title">
          <header><div><p>PARTICIPANT</p><h2 id="participant-editor-title">{editing ? "参加者を編集" : "参加者を追加"}</h2></div><button type="button" aria-label="閉じる" onClick={closeEditor}>×</button></header>
          <form onSubmit={(event) => void save(event)}>
            <label><span>氏名 *</span><input required maxLength={100} value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
            <label><span>特別稽古</span><select value={draft.specialPractice} onChange={(event) => setDraft((current) => ({ ...current, specialPractice: event.target.value as ParticipantInput["specialPractice"] }))}>{SPECIAL_PRACTICE_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
            <label><span>アカウント紐付け</span><select value={draft.linkedUserUid ?? ""} onChange={(event) => setDraft((current) => ({ ...current, linkedUserUid: event.target.value || null }))}>
              <option value="">未紐付け</option>
              {members.map((member) => {
                const assignedParticipantId = linkedParticipantByUid.get(member.uid);
                const unavailable = Boolean(assignedParticipantId && assignedParticipantId !== editing?.id);
                return <option value={member.uid} disabled={unavailable} key={member.uid}>{memberLabel(member)}{unavailable ? "（他の参加者に紐付け済み）" : ""}</option>;
              })}
            </select></label>
            <label><span>公開備考</span><textarea rows={4} maxLength={2000} value={draft.publicNote} onChange={(event) => setDraft((current) => ({ ...current, publicNote: event.target.value }))} /></label>
            <label className={styles.activeToggle}><input type="checkbox" checked={draft.active} onChange={(event) => setDraft((current) => ({ ...current, active: event.target.checked }))} /><span>参加中</span></label>
            {editing?.active && !draft.active && <p className={styles.warning}>参加終了にすると通常一覧から非表示になります。データは削除されません。</p>}
            {formError && <p className={styles.formError} role="alert">{formError}</p>}
            <footer><button className={styles.cancelButton} type="button" onClick={closeEditor}>キャンセル</button><button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button></footer>
          </form>
        </section>
      </div>}
    </main>
  );
}
