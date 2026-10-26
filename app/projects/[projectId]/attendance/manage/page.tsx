"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/AuthProvider";
import type { ProjectMember } from "@/lib/auth";
import {
  getProjectAttendanceRecords,
  upsertProjectAttendanceRecord,
  type AttendanceRecord,
  type AttendanceStatus,
} from "@/lib/attendance";
import {
  buildAttendanceManagementMatrix,
  buildChangedManagementInput,
  buildManagementDraft,
  formatAttendanceCell,
  getManagementDraftError,
  type AttendanceManagementDraft,
  type AttendanceManagementFilter,
} from "@/lib/attendance-management";
import { buildFutureRehearsalDays, findSelfParticipant, formatRehearsalDayItem } from "@/lib/attendance-view";
import { getProjectMembers } from "@/lib/firestore";
import { SPECIAL_PRACTICE_LABELS, type Participant } from "@/lib/participants";
import { getProjectAttendanceParticipants } from "@/lib/people";
import { getAttendanceManagementAccess } from "@/lib/project-navigation";
import { getAllProjectRehearsals, type Rehearsal } from "@/lib/rehearsals";
import { useProjectAccess } from "../../ProjectAccess";
import { RehearsalSectionNavigation } from "../../RehearsalSectionNavigation";
import styles from "./attendance-manage.module.css";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; mark: string }[] = [
  { value: "attending", label: "参加", mark: "○" },
  { value: "absent", label: "不参加", mark: "×" },
  { value: "tentative", label: "未定", mark: "△" },
];

type EditingCell = {
  participant: Participant;
  date: string;
  record: AttendanceRecord | null;
};

function formatDate(date: string, long = false): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    ...(long ? { year: "numeric" } : {}),
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00+09:00`));
}

function timestampToDate(value: unknown): Date | null {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate() as Date;
  }
  return null;
}

function formatUpdatedAt(value: unknown): string {
  const date = timestampToDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function memberName(member: ProjectMember | undefined, uid: string): string {
  return member?.displayName || member?.email || uid || "—";
}

async function fetchManagementData(projectId: string) {
  const [participants, rehearsals, records, members] = await Promise.all([
    getProjectAttendanceParticipants(projectId),
    getAllProjectRehearsals(projectId),
    getProjectAttendanceRecords(projectId),
    getProjectMembers(projectId),
  ]);
  return { participants, rehearsals, records, members };
}

export default function AttendanceManagePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { profile } = useAuth();
  const { role } = useProjectAccess();
  const { canView, canEdit } = getAttendanceManagementAccess(role);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [filter, setFilter] = useState<AttendanceManagementFilter>("all");
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [draft, setDraft] = useState<AttendanceManagementDraft>(buildManagementDraft(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const days = useMemo(() => buildFutureRehearsalDays(rehearsals), [rehearsals]);
  const rows = useMemo(
    () => buildAttendanceManagementMatrix(participants, days, records, filter),
    [days, filter, participants, records]
  );
  const memberByUid = useMemo(() => new Map(members.map((member) => [member.uid, member])), [members]);
  const selfParticipantId = useMemo(() => profile ? findSelfParticipant(participants, profile.uid)?.id : undefined, [participants, profile]);
  const draftError = getManagementDraftError(draft);

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const data = await fetchManagementData(projectId);
      setParticipants(data.participants);
      setRehearsals(data.rehearsals);
      setRecords(data.records);
      setMembers(data.members);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "出欠管理情報を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchManagementData(projectId)
      .then((data) => {
        if (!active) return;
        setParticipants(data.participants);
        setRehearsals(data.rehearsals);
        setRecords(data.records);
        setMembers(data.members);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "出欠管理情報を読み込めませんでした");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  function openEditor(participant: Participant, date: string, record: AttendanceRecord | null) {
    if (!canEdit) return;
    setEditing({ participant, date, record });
    setDraft(buildManagementDraft(record));
    setFormError("");
    setNotice("");
  }

  function selectStatus(status: AttendanceStatus) {
    const day = days.find(({ date }) => date === editing?.date);
    setDraft((current) => status === "attending" ? {
      ...current,
      status,
      availableFrom: current.availableFrom ?? day?.fullTimeRange?.from ?? null,
      availableUntil: current.availableUntil ?? day?.fullTimeRange?.until ?? null,
    } : { ...current, status, availableFrom: null, availableUntil: null });
    setFormError("");
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || !profile || !canEdit || saving) return;
    const validationError = getManagementDraftError(draft);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    const input = buildChangedManagementInput(editing.participant.id, editing.date, draft, editing.record);
    if (!input) {
      setNotice(draft.status === null ? "参加・不参加・未定を選択してください" : "保存する変更はありません");
      if (draft.status !== null) setEditing(null);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      await upsertProjectAttendanceRecord(projectId, input, profile.uid);
      setRecords(await getProjectAttendanceRecords(projectId));
      setEditing(null);
      setNotice(`${editing.participant.displayName}さんの${formatDate(editing.date)}の出欠を保存しました`);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "出欠を保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  if (!canView) return <main className={styles.page}><section className={styles.denied}><h1>全体出欠</h1><p>この画面を閲覧する権限がありません。</p><Link href={`/projects/${projectId}/attendance`}>出欠入力へ戻る</Link></section></main>;

  return <>
    <RehearsalSectionNavigation projectId={projectId} />
    <main className={styles.page}>
    <header className={styles.header}>
      <div><Link href={`/projects/${projectId}/attendance`}>← 出欠入力へ戻る</Link><p>TEAM ATTENDANCE</p><h1>全体出欠</h1></div>
      <span>参加者 {participants.filter(({ active }) => active).length}名 / 稽古日 {days.length}日</span>
    </header>

    <div className={styles.toolbar} role="group" aria-label="表示対象">
      {([['all', '全員'], ['unanswered', '未回答あり'], ['tentative', '未定あり']] as const).map(([value, label]) => <button type="button" data-selected={filter === value} onClick={() => setFilter(value)} key={value}>{label}</button>)}
    </div>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={() => void load()}>再読み込み</button></p>}

    {loading ? <p className={styles.empty}>読み込み中…</p> : days.length === 0 ? <p className={styles.empty}>今後の稽古予定はありません。</p> : rows.length === 0 ? <p className={styles.empty}>条件に該当する参加者はいません。</p> : <>
      <section className={styles.matrixWrap} aria-label="参加者と稽古日の出欠表">
        <table className={styles.matrix}>
          <thead><tr><th>参加者</th>{days.map((day) => <th key={day.date}><b>{formatDate(day.date)}</b><small>{day.rehearsals.length}件</small></th>)}</tr></thead>
          <tbody>{rows.map((row) => <tr data-self={row.participant.id === selfParticipantId} key={row.participant.id}><th><b>{row.participant.displayName}</b>{row.participant.specialPractice !== "none" && <small>{SPECIAL_PRACTICE_LABELS[row.participant.specialPractice]}</small>}</th>{row.cells.map(({ date, record }) => <td key={date}>{canEdit ? <button type="button" data-status={record?.status ?? "unanswered"} onClick={() => openEditor(row.participant, date, record)}>{formatAttendanceCell(record)}</button> : <span className={styles.cellDisplay} data-status={record?.status ?? "unanswered"}>{formatAttendanceCell(record)}</span>}</td>)}</tr>)}</tbody>
        </table>
      </section>

      <section className={styles.mobileDays} aria-label="日付別の出欠一覧">
        {days.map((day) => <article key={day.date}><header><h2>{formatDate(day.date, true)}</h2><ul>{day.rehearsals.map((rehearsal) => <li key={rehearsal.id}>{formatRehearsalDayItem(rehearsal)}</li>)}</ul></header>{rows.map((row) => {
          const cell = row.cells.find(({ date }) => date === day.date);
          if (!cell) return null;
          const content = <><span><b>{row.participant.displayName}</b>{row.participant.specialPractice !== "none" && <small>{SPECIAL_PRACTICE_LABELS[row.participant.specialPractice]}</small>}</span><strong data-status={cell.record?.status ?? "unanswered"}>{formatAttendanceCell(cell.record)}</strong></>;
          return canEdit ? <button className={styles.mobileRow} data-self={row.participant.id === selfParticipantId} type="button" onClick={() => openEditor(row.participant, day.date, cell.record)} key={row.participant.id}>{content}</button> : <div className={styles.mobileRow} data-self={row.participant.id === selfParticipantId} key={row.participant.id}>{content}</div>;
        })}</article>)}
      </section>
    </>}

    {editing && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !saving) setEditing(null); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="attendance-editor-title">
        <header><div><p>{formatDate(editing.date, true)}</p><h2 id="attendance-editor-title">{editing.participant.displayName}さんの出欠</h2></div><button type="button" aria-label="閉じる" onClick={() => setEditing(null)}>×</button></header>
        <form onSubmit={(event) => void save(event)}>
          <div className={styles.statusOptions}>{STATUS_OPTIONS.map((option) => <button type="button" data-selected={draft.status === option.value} onClick={() => selectStatus(option.value)} key={option.value}><b>{option.mark}</b>{option.label}</button>)}</div>
          {draft.status === "attending" && <div className={styles.timeFields}><label><span>参加可能時間</span><input type="time" value={draft.availableFrom ?? ""} onChange={(event) => { setDraft((current) => ({ ...current, availableFrom: event.target.value || null })); setFormError(""); }} /></label><span>〜</span><label><span className={styles.visuallyHidden}>終了時刻</span><input type="time" value={draft.availableUntil ?? ""} onChange={(event) => { setDraft((current) => ({ ...current, availableUntil: event.target.value || null })); setFormError(""); }} /></label>{days.find(({ date }) => date === editing.date)?.fullTimeRange && <button className={styles.fullTimeButton} type="button" onClick={() => { const range = days.find(({ date }) => date === editing.date)?.fullTimeRange; if (range) setDraft((current) => ({ ...current, availableFrom: range.from, availableUntil: range.until })); setFormError(""); }}>その日の全時間参加</button>}</div>}
          <label className={styles.noteField}><span>公開備考</span><textarea disabled={draft.status === null} maxLength={2000} rows={4} value={draft.publicNote} onChange={(event) => setDraft((current) => ({ ...current, publicNote: event.target.value }))} /></label>
          {editing.record && <dl className={styles.updated}><div><dt>最終更新者</dt><dd>{memberName(memberByUid.get(editing.record.updatedByUid), editing.record.updatedByUid)}</dd></div><div><dt>最終更新日時</dt><dd>{formatUpdatedAt(editing.record.updatedAt)}</dd></div></dl>}
          {(formError || (draft.status === "attending" && draftError)) && <p className={styles.formError} role="alert">{formError || draftError}</p>}
          <footer><button type="button" onClick={() => setEditing(null)}>キャンセル</button><button type="submit" disabled={saving || draftError !== null}>{saving ? "保存中…" : "保存"}</button></footer>
        </form>
      </section>
    </div>}
    </main>
  </>;
}
