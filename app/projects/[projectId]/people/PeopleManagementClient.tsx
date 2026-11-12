"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ProjectMember } from "@/lib/auth";
import type { ProjectPerformanceRecord } from "@/lib/firestore";
import {
  EMPTY_MANAGED_PERSON_INPUT,
  PEOPLE_MANAGEMENT_SORT_OPTIONS,
  createProjectPerson,
  filterManagedPeople,
  getPersonAssociations,
  normalizePeopleManagementListSort,
  setProjectPersonEnded,
  sortManagedPeople,
  updateProjectPerson,
  type PeopleManagementListSort,
  type ManagedPersonInput,
} from "@/lib/people-management";
import { getProjectPeopleWithFallback, type ProjectPerson } from "@/lib/people";
import {
  formatRehearsalParticipationTypes,
  REHEARSAL_PARTICIPATION_OPTIONS,
  toggleRehearsalParticipationType,
} from "@/lib/rehearsal-participation";
import {
  cancelProjectUserLinkReservationClient,
  changeProjectUserLinkReservationClient,
  createProjectUserLinkReservationClient,
  getProjectUserLinkReservationsClient,
} from "@/lib/user-link-reservation-client";
import { getUserLinkReservationView } from "@/lib/user-link-reservation-view";
import type { UserLinkReservation } from "@/lib/user-link-reservations";
import {
  createProjectInviteLink,
  listProjectInviteLinks,
  revokeProjectInviteLink,
} from "@/lib/project-invite-link-client";
import {
  getPersonInviteState,
  type ProjectInviteLinkSummary,
} from "@/lib/project-invite-links";
import {
  listLineLinkHistory,
  repairLinePersonLink,
  type LineLinkHistoryItem,
} from "@/lib/line-link-event-client";
import { lineLinkEventLabel } from "@/lib/line-link-events";
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
  const { canEdit, canManageMembers, actor } = useProjectAccess();
  const [people, setPeople] = useState(initialPeople);
  const [editing, setEditing] = useState<ProjectPerson | null | undefined>(undefined);
  const [draft, setDraft] = useState<ManagedPersonInput>(EMPTY_MANAGED_PERSON_INPUT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reservations, setReservations] = useState<UserLinkReservation[]>([]);
  const [reservationLoading, setReservationLoading] = useState(canEdit);
  const [reservationBusy, setReservationBusy] = useState(false);
  const [reservationEmail, setReservationEmail] = useState("");
  const [reservationEditing, setReservationEditing] = useState(false);
  const [reservationError, setReservationError] = useState("");
  const [reservationLoadError, setReservationLoadError] = useState("");
  const [inviteLinks, setInviteLinks] = useState<ProjectInviteLinkSummary[]>([]);
  const [inviteLinksLoading, setInviteLinksLoading] = useState(canManageMembers);
  const [inviteBusyPersonId, setInviteBusyPersonId] = useState("");
  const [createdInvite, setCreatedInvite] = useState<{ personName: string; url: string } | null>(null);
  const [inviteError, setInviteError] = useState("");
  const [newInviteOpen, setNewInviteOpen] = useState(false);
  const [newInviteName, setNewInviteName] = useState("");
  const [newInvitePersonId, setNewInvitePersonId] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [sortOrder, setSortOrder] = useState<PeopleManagementListSort>("cast_first");
  const [lineLinkEvents, setLineLinkEvents] = useState<LineLinkHistoryItem[]>([]);
  const [lineHistoryError, setLineHistoryError] = useState("");
  const [repairingPersonId, setRepairingPersonId] = useState("");
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
  const pendingReservationByPersonId = useMemo(() => new Map(
    reservations
      .filter((reservation) => reservation.status === "pending")
      .map((reservation) => [reservation.personId, reservation] as const)
  ), [reservations]);
  const editingReservation = editing
    ? pendingReservationByPersonId.get(editing.id)
    : undefined;
  const reservationView = editing
    ? getUserLinkReservationView({
        canEdit,
        linkedUserUid: draft.linkedUserUid,
        reservation: editingReservation,
      })
    : { kind: "hidden" as const };

  useEffect(() => {
    if (!canEdit) return;
    let active = true;
    void getProjectUserLinkReservationsClient(project.id)
      .then((items) => { if (active) setReservations(items); })
      .catch((loadError) => {
        if (active) {
          setReservationLoadError(loadError instanceof Error
            ? loadError.message
            : "紐づけ予約を読み込めませんでした");
        }
      })
      .finally(() => { if (active) setReservationLoading(false); });
    return () => { active = false; };
  }, [canEdit, project.id]);

  useEffect(() => {
    if (!canManageMembers) return;
    let active = true;
    void listProjectInviteLinks(project.id)
      .then((items) => { if (active) setInviteLinks(items); })
      .catch((loadError) => {
        if (active) setInviteError(loadError instanceof Error
          ? loadError.message
          : "招待状況を読み込めませんでした");
      })
      .finally(() => { if (active) setInviteLinksLoading(false); });
    return () => { active = false; };
  }, [canManageMembers, project.id]);

  useEffect(() => {
    if (!canManageMembers) return;
    let active = true;
    void listLineLinkHistory(project.id)
      .then((items) => { if (active) setLineLinkEvents(items); })
      .catch(() => { if (active) setLineHistoryError("LINE連携履歴を読み込めませんでした"); });
    return () => { active = false; };
  }, [canManageMembers, project.id]);

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
    setReservationError("");
    setReservationEmail(pendingReservationByPersonId.get(person.id)?.email ?? "");
    setReservationEditing(false);
  }

  async function issuePersonInvite(person: ProjectPerson, inviteToRevoke?: ProjectInviteLinkSummary) {
    if (!canManageMembers || inviteBusyPersonId) return;
    if (inviteToRevoke && !window.confirm(
      "新しい招待リンクを発行すると、現在の招待リンクは使えなくなります。\n新しいリンクを改めて本人へ案内してください。"
    )) return;
    setInviteBusyPersonId(person.id);
    setInviteError("");
    setCreatedInvite(null);
    try {
      if (inviteToRevoke) {
        await revokeProjectInviteLink(project.id, inviteToRevoke.id);
      }
      const result = await createProjectInviteLink(project.id, person.id);
      setInviteLinks((current) => [
        result.invite,
        ...current.map((item) => item.id === inviteToRevoke?.id
          ? { ...item, status: "revoked" as const }
          : item),
      ]);
      setCreatedInvite({ personName: person.displayName, url: result.url });
      setNotice(`${person.displayName}さん用の招待リンクを作成しました`);
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : "招待リンクを作成できませんでした");
      if (inviteToRevoke) {
        void listProjectInviteLinks(project.id).then(setInviteLinks).catch(() => undefined);
      }
    } finally { setInviteBusyPersonId(""); }
  }

  async function copyCreatedInvite() {
    if (!createdInvite) return;
    try { await navigator.clipboard.writeText(createdInvite.url); setNotice(`${createdInvite.personName}さん用の招待URLをコピーしました`); }
    catch { setInviteError("URLをコピーできませんでした"); }
  }

  async function cancelPersonInvite(invite: ProjectInviteLinkSummary, personName: string) {
    if (!canManageMembers || inviteBusyPersonId || !window.confirm(`${personName}さんへの招待を取り消しますか？`)) return;
    setInviteBusyPersonId(invite.personId ?? "invite");
    setInviteError("");
    try {
      await revokeProjectInviteLink(project.id, invite.id);
      setInviteLinks((current) => current.map((item) => item.id === invite.id
        ? { ...item, status: "revoked" as const }
        : item));
      setCreatedInvite(null);
      setNotice(`${personName}さんへの招待を取り消しました`);
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : "招待を取り消せませんでした");
    } finally { setInviteBusyPersonId(""); }
  }

  async function repairLineLink(person: ProjectPerson) {
    if (!canManageMembers || !person.linkedUserUid || repairingPersonId) return;
    const member = memberByUid.get(person.linkedUserUid);
    if (member && member.role !== "viewer") {
      setInviteError("OwnerまたはEditorの連携は自動解除できません。先にシステム利用者の権限を確認してください。");
      return;
    }
    if (!window.confirm(
      `${person.displayName}さんの誤った連携を解除しますか？\n\n対象のViewerはこの公演を利用できなくなります。`+
      "\nLINEログインや他公演の利用権は解除されません。\n解除後、新しい招待リンクを発行します。"
    )) return;
    setRepairingPersonId(person.id);
    setInviteError("");
    setCreatedInvite(null);
    try {
      await repairLinePersonLink(project.id, person.id);
      setPeople(await getProjectPeopleWithFallback(project.id));
      setLineLinkEvents(await listLineLinkHistory(project.id));
      try {
        const result = await createProjectInviteLink(project.id, person.id);
        setInviteLinks((current) => [result.invite, ...current]);
        setCreatedInvite({ personName: person.displayName, url: result.url });
        setNotice(`${person.displayName}さんの連携を解除し、新しい招待リンクを発行しました`);
      } catch {
        setNotice(`${person.displayName}さんの連携を解除しました`);
        setInviteError("招待リンクを発行できませんでした。関係者一覧からもう一度発行してください。");
      }
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : "誤連携を解除できませんでした");
    } finally {
      setRepairingPersonId("");
    }
  }

  async function createNewPersonAndInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageMembers || inviteBusyPersonId || !newInviteName.trim()) return;
    setInviteBusyPersonId("new");
    setInviteError("");
    setCreatedInvite(null);
    const personName = newInviteName.trim();
    try {
      let personId = newInvitePersonId;
      if (!personId) {
        personId = await createProjectPerson(project.id, {
          ...EMPTY_MANAGED_PERSON_INPUT,
          displayName: personName,
        }, actor);
        setNewInvitePersonId(personId);
        setPeople(await getProjectPeopleWithFallback(project.id));
      }
      const result = await createProjectInviteLink(project.id, personId);
      setInviteLinks((current) => [result.invite, ...current]);
      setCreatedInvite({ personName, url: result.url });
      setNewInviteName("");
      setNewInvitePersonId("");
      setNewInviteOpen(false);
      setNotice(`${personName}さんを関係者に追加し、招待リンクを作成しました`);
    } catch (caught) {
      setPeople(await getProjectPeopleWithFallback(project.id).catch(() => people));
      setInviteError(caught instanceof Error ? caught.message : "新しい人を招待できませんでした");
    } finally { setInviteBusyPersonId(""); }
  }

  function closeEditor() {
    if (!saving && !reservationBusy) setEditing(undefined);
  }

  async function saveReservation(change: boolean) {
    if (!canEdit || !editing || reservationBusy) return;
    setReservationBusy(true);
    setReservationError("");
    setNotice("");
    try {
      const input = {
        projectId: project.id,
        personId: editing.id,
        email: reservationEmail,
      };
      const result = change
        ? await changeProjectUserLinkReservationClient(input)
        : await createProjectUserLinkReservationClient(input);
      if (result.outcome !== "pending") {
        setPeople(await getProjectPeopleWithFallback(project.id));
        setEditing(undefined);
        setNotice(result.outcome === "already_linked"
          ? "すでにこの関係者と紐づいています"
          : "システム利用者との紐づけが完了しました");
        return;
      }
      if (!result.reservation) {
        throw new Error("作成した予約情報を確認できませんでした");
      }
      const reservation = result.reservation;
      setReservations((current) => [
        ...current.filter((item) => item.personId !== editing.id || item.status !== "pending"),
        reservation,
      ]);
      setReservationEmail(reservation.email);
      setReservationEditing(false);
      if (result.inviteOutcome === "created") {
        setNotice(result.inviteEmailStatus === "sent"
          ? "Googleアカウントを予約登録し、SeisakuBoardへの招待メールを送信しました"
          : "Googleアカウントを予約登録し、SeisakuBoardへの招待を作成しました。招待メールはシステム利用者画面から再送できます");
      } else {
        setNotice(change
          ? "Googleアカウントの予約を変更しました。招待はすでに作成されています"
          : "Googleアカウントを予約登録しました。招待はすでに作成されています");
      }
    } catch (saveError) {
      setReservationError(saveError instanceof Error
        ? saveError.message
        : "紐づけ予約を保存できませんでした");
    } finally {
      setReservationBusy(false);
    }
  }

  async function cancelReservation() {
    if (!canEdit || !editing || !editingReservation || reservationBusy) return;
    if (!window.confirm("この紐づけ予約を解除しますか？\n正式なシステム利用者連携の解除ではありません。")) {
      return;
    }
    setReservationBusy(true);
    setReservationError("");
    setNotice("");
    try {
      await cancelProjectUserLinkReservationClient({
        projectId: project.id,
        personId: editing.id,
      });
      setReservations((current) => current.filter(
        (item) => item.personId !== editing.id || item.status !== "pending"
      ));
      setReservationEmail("");
      setReservationEditing(false);
      setNotice("紐づけ予約を解除しました");
    } catch (cancelError) {
      setReservationError(cancelError instanceof Error
        ? cancelError.message
        : "紐づけ予約を解除できませんでした");
    } finally {
      setReservationBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving || reservationBusy) return;
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
    if (!canEdit || !editing || saving || reservationBusy) return;
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
      <div><Link href={`/projects/${project.id}`}>← 公演トップ</Link><p>PEOPLE</p><h1>関係者管理</h1><span>公演に関わる人を登録し、SeisakuBoardへの招待と利用状況を管理します。</span></div>
      <div className={styles.headerActions}>
        {canManageMembers && <button type="button" onClick={() => { setNewInviteOpen(true); setNewInviteName(""); setNewInvitePersonId(""); setInviteError(""); }}>新しい人を招待</button>}
        {canEdit && <button type="button" data-secondary onClick={openCreate}>その他の関係者を追加</button>}
      </div>
    </header>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {reservationLoadError && <p className={styles.error} role="alert">{reservationLoadError}</p>}
    {inviteError && <p className={styles.errorNotice} role="alert">{inviteError}</p>}
    {createdInvite && <section className={styles.createdInvite} aria-label="作成した招待リンク">
      <div><strong>{createdInvite.personName}さん用の招待リンク</strong><span>このリンクは7日間有効です。安全な方法で本人へ送ってください。</span></div>
      <button type="button" onClick={() => void copyCreatedInvite()}>リンクをコピー</button>
      <small>安全のため、このリンクは画面を閉じると再表示できません。</small>
    </section>}
    <div className={styles.listControls}>
      <label className={styles.sortControl}>
        <span>並び順</span>
        <select value={sortOrder} onChange={(event) => setSortOrder(normalizePeopleManagementListSort(event.target.value))}>
          {PEOPLE_MANAGEMENT_SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
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
          <thead><tr><th>本名（管理用）</th><th>出欠</th><th>参加する稽古</th><th>利用状態</th><th>キャスト</th><th>スタッフ</th><th>操作</th></tr></thead>
          <tbody>{visiblePeople.map((person) => {
            const association = getPersonAssociations(person.id, person.displayName, cast, staff);
            const member = person.linkedUserUid ? memberByUid.get(person.linkedUserUid) : undefined;
            const pendingReservation = pendingReservationByPersonId.get(person.id);
            const inviteState = getPersonInviteState({ personId: person.id, linkedUserUid: person.linkedUserUid, invites: inviteLinks });
            const pendingInvite = inviteLinks.find((invite) => invite.personId === person.id && invite.status === "pending");
            return <tr key={person.id}>
              <td data-label="本名（管理用）"><strong>{person.displayName}</strong>{!person.active && <span className={styles.inactiveBadge}>終了済み</span>}</td>
              <td data-label="出欠">{person.attendanceTarget ? "対象" : "対象外"}</td>
              <td data-label="参加する稽古">{formatRehearsalParticipationTypes(person.rehearsalParticipationTypes)}</td>
              <td data-label="利用状態"><div className={styles.inviteStatusCell}>
                <span data-state={inviteState}>{inviteState === "using"
                  ? `SeisakuBoard利用中${member ? `：${memberLabel(member)}` : ""}`
                  : !canManageMembers ? "未連携"
                    : inviteState === "invited" ? "招待済み" : inviteLinksLoading ? "確認中…" : "未招待"}</span>
                {!person.linkedUserUid && canEdit && pendingReservation && <small>{pendingReservation.conflictPersonName ? "Googleアカウント登録待ち（競合）" : "Googleアカウント登録待ち"}</small>}
                {canManageMembers && person.active && inviteState === "not_invited" && !inviteLinksLoading && <button type="button" disabled={Boolean(inviteBusyPersonId)} onClick={() => void issuePersonInvite(person)}>{inviteBusyPersonId === person.id ? "作成中…" : "招待する"}</button>}
                {canManageMembers && inviteState === "invited" && pendingInvite && <div className={styles.inviteRowActions}>
                  <button type="button" disabled={Boolean(inviteBusyPersonId)} onClick={() => void issuePersonInvite(person, pendingInvite)}>新しい招待リンクを発行</button>
                  <button type="button" data-danger disabled={Boolean(inviteBusyPersonId)} onClick={() => void cancelPersonInvite(pendingInvite, person.displayName)}>招待を取り消す</button>
                </div>}
                {canManageMembers && person.linkedUserUid && member?.role === "viewer" && <button
                  type="button"
                  data-danger
                  disabled={Boolean(repairingPersonId)}
                  onClick={() => void repairLineLink(person)}
                >{repairingPersonId === person.id ? "解除中…" : "誤連携を解除して再招待"}</button>}
                {canManageMembers && person.linkedUserUid && member && member.role !== "viewer" && <small>
                  Owner・Editorの連携解除は権限確認が必要です。
                </small>}
              </div></td>
              <td data-label="キャスト">{association.castLabels.join(" / ") || "—"}</td>
              <td data-label="スタッフ">{association.staffRoles.join(" / ") || "—"}</td>
              <td data-label="操作">{canEdit ? <button className={styles.editButton} type="button" onClick={() => openEdit(person)}>編集</button> : "—"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    )}

    {canManageMembers && <section className={styles.lineHistory} aria-labelledby="line-link-history-title">
      <div><h2 id="line-link-history-title">LINE連携履歴</h2><span>最新100件</span></div>
      {lineHistoryError && <p className={styles.error} role="alert">{lineHistoryError}</p>}
      {!lineHistoryError && lineLinkEvents.length === 0 && <p>LINE連携履歴はまだありません。</p>}
      {lineLinkEvents.length > 0 && <ul>{lineLinkEvents.map((item) => <li key={item.id}>
        <time>{item.occurredAt ? new Intl.DateTimeFormat("ja-JP", {
          timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit",
        }).format(new Date(item.occurredAt)) : "日時未確定"}</time>
        <strong>{item.personName}</strong>
        <span>LINE表示名：{item.lineDisplayName}</span>
        <em>{lineLinkEventLabel(item.eventType)}</em>
      </li>)}</ul>}
    </section>}

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
          <label><span>システム利用者との連携</span><select value={draft.linkedUserUid ?? ""} disabled={Boolean(editingReservation && !draft.linkedUserUid) || reservationBusy} onChange={(event) => setDraft((current) => ({ ...current, linkedUserUid: event.target.value || null }))}>
            <option value="">未連携</option>
            {members.map((member) => {
              const assignedPersonId = linkedPersonByUid.get(member.uid);
              const unavailable = Boolean(assignedPersonId && assignedPersonId !== editing?.id);
              return <option key={member.uid} value={member.uid} disabled={unavailable}>{memberLabel(member)}{unavailable ? "（他の関係者に連携済み）" : ""}</option>;
            })}
          </select></label>
          {editing && reservationLoading && !editing.linkedUserUid
            ? <p className={styles.reservationLoading}>紐づけ予約を確認しています…</p>
            : null}
          {editing && !reservationLoading && reservationView.kind !== "hidden" && <section className={styles.reservationSection} aria-label="Googleアカウントで紐づけ予約">
            <strong>Googleアカウントで紐づけ予約</strong>
            <p>本人がこの公演へ招待され、同じGoogleアカウントでログインすると自動で紐づけられます。</p>
            <p>このメールアドレスがまだSeisakuBoardに招待されていない場合、閲覧権限で自動的に招待します。</p>
            {reservationView.kind === "pending" && !reservationEditing ? <>
              <span className={styles.reservationPending}>登録待ち：{reservationView.email}</span>
              {reservationView.conflictPersonName && <p className={styles.reservationConflict} role="alert">
                この予約は既存の紐づけと競合しています。現在、このGoogleアカウントは「{reservationView.conflictPersonName}」さんと紐づいています。
              </p>}
              <p className={styles.reservationHint}>既存のシステム利用者を選ぶ場合は、先に予約を解除してください。</p>
              <div className={styles.reservationActions}>
                <button type="button" disabled={reservationBusy} onClick={() => {
                  setReservationEmail(reservationView.email);
                  setReservationEditing(true);
                  setReservationError("");
                }}>予約変更</button>
                <button type="button" data-danger disabled={reservationBusy} onClick={() => void cancelReservation()}>
                  {reservationBusy ? "処理中…" : "予約解除"}
                </button>
              </div>
            </> : <>
              <label className={styles.reservationInput}>
                <span>Googleアカウントのメールアドレス</span>
                <input
                  type="text"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={254}
                  value={reservationEmail}
                  disabled={reservationBusy}
                  onChange={(event) => setReservationEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void saveReservation(reservationView.kind === "pending");
                    }
                  }}
                />
              </label>
              <div className={styles.reservationActions}>
                {reservationView.kind === "pending" && <button type="button" disabled={reservationBusy} onClick={() => {
                  setReservationEmail(reservationView.email);
                  setReservationEditing(false);
                  setReservationError("");
                }}>キャンセル</button>}
                <button type="button" disabled={reservationBusy || !reservationEmail.trim()} onClick={() => void saveReservation(reservationView.kind === "pending")}>
                  {reservationBusy ? "保存中…" : reservationView.kind === "pending" ? "変更を保存" : "予約する"}
                </button>
              </div>
            </>}
            {reservationError && <p className={styles.error} role="alert">{reservationError}</p>}
          </section>}
          <label><span>公開備考</span><textarea rows={5} maxLength={2000} value={draft.publicNote} onChange={(event) => setDraft((current) => ({ ...current, publicNote: event.target.value }))} /></label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {editing && <button className={editing.active ? styles.endButton : styles.resumeButton} type="button" onClick={() => void toggleEnded()} disabled={saving || reservationBusy}>
            {editing.active ? "終了済みにする" : "終了済みを解除"}
          </button>}
          <footer><button type="button" onClick={closeEditor} disabled={saving || reservationBusy}>キャンセル</button><button type="submit" disabled={saving || reservationBusy}>{saving ? "保存中…" : "保存"}</button></footer>
        </form>
      </section>
    </div>}
    {newInviteOpen && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !inviteBusyPersonId) { setNewInviteOpen(false); setNewInvitePersonId(""); } }}>
      <section className={styles.newInviteDialog} role="dialog" aria-modal="true" aria-labelledby="new-person-invite-title">
        <header><div><p>INVITE</p><h2 id="new-person-invite-title">新しい人を招待</h2></div><button type="button" aria-label="閉じる" onClick={() => { setNewInviteOpen(false); setNewInvitePersonId(""); }}>×</button></header>
        <form onSubmit={(event) => void createNewPersonAndInvite(event)}>
          <p>氏名を登録して、その人専用の招待リンクを作成します。参加する稽古などは後から編集できます。</p>
          <label><span>氏名 *</span><input required maxLength={100} autoFocus value={newInviteName} onChange={(event) => setNewInviteName(event.target.value)} /></label>
          {newInvitePersonId && <p className={styles.newInviteRetry}>関係者の登録は完了しています。招待リンクの作成をもう一度お試しください。</p>}
          <footer><button type="button" disabled={Boolean(inviteBusyPersonId)} onClick={() => { setNewInviteOpen(false); setNewInvitePersonId(""); }}>キャンセル</button><button type="submit" disabled={Boolean(inviteBusyPersonId) || !newInviteName.trim()}>{inviteBusyPersonId === "new" ? "作成中…" : newInvitePersonId ? "招待リンクを作成" : "関係者を登録して招待"}</button></footer>
        </form>
      </section>
    </div>}
  </main>;
}
