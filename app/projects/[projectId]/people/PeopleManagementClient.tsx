"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProjectMember } from "@/lib/auth";
import type { ProjectPerformanceRecord } from "@/lib/firestore";
import {
  EMPTY_MANAGED_PERSON_INPUT,
  createProjectPerson,
  filterManagedPeople,
  getPersonAssociations,
  setProjectPersonEnded,
  sortManagedPeople,
  updateProjectPerson,
  type ManagedPeopleSort,
  type ManagedPersonInput,
} from "@/lib/people-management";
import { getProjectPeopleWithFallback, type ProjectPerson } from "@/lib/people";
import {
  formatRehearsalParticipationTypes,
  REHEARSAL_PARTICIPATION_OPTIONS,
  toggleRehearsalParticipationType,
} from "@/lib/rehearsal-participation";
import { useProjectAccess } from "../ProjectAccess";
import styles from "./people.module.css";

function memberLabel(member: ProjectMember): string {
  return member.displayName || member.email || member.uid;
}

export function PeopleManagementClient({
  project,
  initialPeople,
  members,
}: {
  project: ProjectPerformanceRecord;
  initialPeople: ProjectPerson[];
  members: ProjectMember[];
}) {
  const { canEdit, actor } = useProjectAccess();
  const [people, setPeople] = useState(initialPeople);
  const [editing, setEditing] = useState<ProjectPerson | null | undefined>(undefined);
  const [draft, setDraft] = useState<ManagedPersonInput>(EMPTY_MANAGED_PERSON_INPUT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [sortOrder, setSortOrder] = useState<ManagedPeopleSort>("cast_first");
  const memberByUid = useMemo(() => new Map(members.map((member) => [member.uid, member])), [members]);
  const linkedPersonByUid = useMemo(() => new Map(people.flatMap((person) => person.linkedUserUid
    ? [[person.linkedUserUid, person.id] as const]
    : [])), [people]);
  const cast = useMemo(() => project.data.cast ?? [], [project.data.cast]);
  const staff = useMemo(() => project.data.staff ?? [], [project.data.staff]);
  const visiblePeople = useMemo(() => sortManagedPeople(
    filterManagedPeople(people, showInactive),
    cast,
    staff,
    sortOrder
  ), [people, showInactive, cast, staff, sortOrder]);

  function openCreate() {
    if (!canEdit) return;
    setEditing(null);
    setDraft({ ...EMPTY_MANAGED_PERSON_INPUT });
    setError("");
  }

  function openEdit(person: ProjectPerson) {
    if (!canEdit) return;
    setEditing(person);
    setDraft({
      displayName: person.displayName,
      attendanceTarget: person.attendanceTarget,
      specialPractice: person.specialPractice,
      rehearsalParticipationTypes: person.rehearsalParticipationTypes,
      linkedUserUid: person.linkedUserUid,
      publicNote: person.publicNote,
    });
    setError("");
  }

  function closeEditor() {
    if (!saving) setEditing(undefined);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      if (editing) {
        await updateProjectPerson(project.id, editing.id, draft, actor);
        setNotice("関係者情報を更新しました");
      } else {
        await createProjectPerson(project.id, draft, actor);
        setNotice("関係者を追加しました");
      }
      setPeople(await getProjectPeopleWithFallback(project.id));
      setEditing(undefined);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "関係者情報を保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnded() {
    if (!canEdit || !editing || saving) return;
    const ending = editing.active;
    const confirmed = window.confirm(ending
      ? "この関係者を終了済みにします。\n過去の出欠やキャスト・スタッフ情報は削除されません。"
      : "この関係者を通常の関係者へ戻します。");
    if (!confirmed) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await setProjectPersonEnded(project.id, editing.id, ending, actor);
      setPeople(await getProjectPeopleWithFallback(project.id));
      setEditing(undefined);
      setNotice(ending ? "関係者を終了済みにしました" : "終了済みを解除しました");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "関係者の状態を変更できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href={`/projects/${project.id}`}>← 公演トップ</Link><p>PEOPLE</p><h1>関係者管理</h1><span>公演に関わる実在の人と、出欠・システム利用者との連携を管理します。</span></div>
      {canEdit && <button type="button" onClick={openCreate}>その他の関係者を追加</button>}
    </header>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    <div className={styles.listControls}>
      <label className={styles.sortControl}>
        <span>並び順</span>
        <select value={sortOrder} onChange={(event) => setSortOrder(event.target.value as ManagedPeopleSort)}>
          <option value="cast_first">キャスト優先</option>
          <option value="staff_first">スタッフ優先</option>
          <option value="name">本名順</option>
        </select>
      </label>
      <label className={styles.inactiveFilter}>
        <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
        <span>終了した関係者も表示</span>
      </label>
    </div>
    {people.length === 0 ? <p className={styles.empty}>関係者はまだ登録されていません。通常は公演情報のキャスト・スタッフから登録できます。</p> : (
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>本名（管理用）</th><th>出欠</th><th>参加する稽古</th><th>システム利用者との連携</th><th>キャスト</th><th>スタッフ</th><th>操作</th></tr></thead>
          <tbody>{visiblePeople.map((person) => {
            const association = getPersonAssociations(person.id, person.displayName, cast, staff);
            const member = person.linkedUserUid ? memberByUid.get(person.linkedUserUid) : undefined;
            return <tr key={person.id}>
              <td data-label="本名（管理用）"><strong>{person.displayName}</strong>{!person.active && <span className={styles.inactiveBadge}>終了済み</span>}</td>
              <td data-label="出欠">{person.attendanceTarget ? "対象" : "対象外"}</td>
              <td data-label="参加する稽古">{formatRehearsalParticipationTypes(person.rehearsalParticipationTypes)}</td>
              <td data-label="システム利用者との連携">{person.linkedUserUid ? `連携済：${member ? memberLabel(member) : person.linkedUserUid}` : "未連携"}</td>
              <td data-label="キャスト">{association.castLabels.join(" / ") || "—"}</td>
              <td data-label="スタッフ">{association.staffRoles.join(" / ") || "—"}</td>
              <td data-label="操作">{canEdit ? <button className={styles.editButton} type="button" onClick={() => openEdit(person)}>編集</button> : "—"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    )}

    {editing !== undefined && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeEditor(); }}>
      <section className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="related-person-editor-title">
        <header><div><p>RELATED PERSON</p><h2 id="related-person-editor-title">{editing ? "関係者を編集" : "その他の関係者を追加"}</h2></div><button type="button" aria-label="閉じる" onClick={closeEditor}>×</button></header>
        <form onSubmit={(event) => void save(event)}>
          <label><span>本名（管理用） *</span><input required maxLength={100} value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
          <label className={styles.checkbox}><input type="checkbox" checked={draft.attendanceTarget} onChange={(event) => setDraft((current) => ({ ...current, attendanceTarget: event.target.checked }))} /><span>出欠管理の対象にする</span></label>
          <fieldset className={styles.participationFields}>
            <legend>参加する稽古</legend>
            <div>{REHEARSAL_PARTICIPATION_OPTIONS.map((option) => <label key={option.value}>
              <input
                type="checkbox"
                checked={draft.rehearsalParticipationTypes.includes(option.value)}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  rehearsalParticipationTypes: toggleRehearsalParticipationType(
                    current.rehearsalParticipationTypes,
                    option.value,
                    event.target.checked
                  ),
                }))}
              />
              <span>{option.label}</span>
            </label>)}</div>
          </fieldset>
          <label><span>システム利用者との連携</span><select value={draft.linkedUserUid ?? ""} onChange={(event) => setDraft((current) => ({ ...current, linkedUserUid: event.target.value || null }))}>
            <option value="">未連携</option>
            {members.map((member) => {
              const assignedPersonId = linkedPersonByUid.get(member.uid);
              const unavailable = Boolean(assignedPersonId && assignedPersonId !== editing?.id);
              return <option key={member.uid} value={member.uid} disabled={unavailable}>{memberLabel(member)}{unavailable ? "（他の関係者に連携済み）" : ""}</option>;
            })}
          </select></label>
          <label><span>公開備考</span><textarea rows={5} maxLength={2000} value={draft.publicNote} onChange={(event) => setDraft((current) => ({ ...current, publicNote: event.target.value }))} /></label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {editing && <button className={editing.active ? styles.endButton : styles.resumeButton} type="button" onClick={() => void toggleEnded()} disabled={saving}>
            {editing.active ? "終了済みにする" : "終了済みを解除"}
          </button>}
          <footer><button type="button" onClick={closeEditor} disabled={saving}>キャンセル</button><button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button></footer>
        </form>
      </section>
    </div>}
  </main>;
}
