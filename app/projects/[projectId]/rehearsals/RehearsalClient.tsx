"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import {
  EMPTY_REHEARSAL_INPUT,
  REHEARSAL_TYPES,
  REHEARSAL_TYPE_LABELS,
  createProjectRehearsal,
  createProjectRehearsals,
  deleteProjectRehearsal,
  getProjectRehearsal,
  getProjectRehearsals,
  getRehearsalScheduleCapabilities,
  getRehearsalTypeLabel,
  rehearsalToInput,
  timestampToTokyoInput,
  updateProjectRehearsal,
  type Rehearsal,
  type RehearsalInput,
} from "@/lib/rehearsals";
import { CONFLICT_MESSAGE, isConflictError } from "@/lib/project-revisions";
import { canUseRehearsalScreenshotImport } from "@/lib/rehearsal-import";
import { buildRehearsalPrintModel } from "@/lib/rehearsal-print";
import { useProjectAccess } from "../ProjectAccess";
import { RehearsalImportDialog } from "./RehearsalImportDialog";
import { RehearsalTimeline } from "./RehearsalTimeline";
import styles from "./rehearsals.module.css";

type EditorMode = "single" | "bulk" | "edit" | null;
type ScheduleView = "list" | "timeline";

function todayInTokyo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(rehearsal: Rehearsal): string {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" }).format(rehearsal.startAt.toDate());
}

function formatTime(rehearsal: Rehearsal): string {
  const start = timestampToTokyoInput(rehearsal.startAt).time;
  const end = rehearsal.endAt ? timestampToTokyoInput(rehearsal.endAt).time : "";
  return end ? `${start}–${end}` : `${start}–`;
}

function RehearsalRows({ items, canEdit, onEdit, onDelete }: {
  items: Rehearsal[];
  canEdit: boolean;
  onEdit: (item: Rehearsal) => void;
  onDelete: (item: Rehearsal) => void;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr><th>日付</th><th>時間</th><th>種別</th><th>場所</th><th>内容</th><th>備考</th>{canEdit && <th>操作</th>}</tr></thead>
        <tbody>{items.map((item) => (
          <tr key={item.id}>
            <td data-label="日付">{formatDate(item)}</td>
            <td data-label="時間" className={styles.time}>{formatTime(item)}</td>
            <td data-label="種別"><span className={styles.typeBadge} data-type={item.type}>{getRehearsalTypeLabel(item.type, item.customType)}</span></td>
            <td data-label="場所">{item.venue || "—"}</td>
            <td data-label="内容" className={styles.longText}>{item.content || "—"}</td>
            <td data-label="備考" className={styles.longText}>{item.note || "—"}</td>
            {canEdit && <td data-label="操作"><div className={styles.rowActions}><button type="button" onClick={() => onEdit(item)}>編集</button><button className={styles.dangerLink} type="button" onClick={() => onDelete(item)}>削除</button></div></td>}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function RehearsalFields({ value, onChange, hideDate = false }: { value: RehearsalInput; onChange: (value: RehearsalInput) => void; hideDate?: boolean }) {
  const patch = <Key extends keyof RehearsalInput>(key: Key, next: RehearsalInput[Key]) => onChange({ ...value, [key]: next });
  return (
    <div className={styles.formGrid}>
      {!hideDate && <label><span>日付 *</span><input required type="date" value={value.date} onChange={(event) => patch("date", event.target.value)} /></label>}
      <label><span>開始時刻 *</span><input required type="time" value={value.startTime} onChange={(event) => patch("startTime", event.target.value)} /></label>
      <label><span>終了時刻</span><input type="time" value={value.endTime} onChange={(event) => patch("endTime", event.target.value)} /></label>
      <label><span>種別 *</span><select value={value.type} onChange={(event) => {
        const type = event.target.value as RehearsalInput["type"];
        onChange({ ...value, type, customType: type === "other" ? value.customType : "" });
      }}>{REHEARSAL_TYPES.map((type) => <option key={type} value={type}>{REHEARSAL_TYPE_LABELS[type]}</option>)}</select></label>
      {value.type === "other" && <label><span>その他の種別 *</span><input required maxLength={100} value={value.customType} onChange={(event) => patch("customType", event.target.value)} /></label>}
      <label className={styles.full}><span>場所</span><input maxLength={200} value={value.venue} onChange={(event) => patch("venue", event.target.value)} /></label>
      <label className={styles.full}><span>内容</span><textarea maxLength={2000} rows={3} value={value.content} onChange={(event) => patch("content", event.target.value)} /></label>
      <label className={styles.full}><span>備考</span><textarea maxLength={5000} rows={3} value={value.note} onChange={(event) => patch("note", event.target.value)} /></label>
    </div>
  );
}

export function RehearsalClient({ projectId }: { projectId: string }) {
  const { role, actor } = useProjectAccess();
  const { canEdit, canImport } = getRehearsalScheduleCapabilities(role);
  const [upcoming, setUpcoming] = useState<Rehearsal[]>([]);
  const [past, setPast] = useState<Rehearsal[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<EditorMode>(null);
  const [draft, setDraft] = useState<RehearsalInput>({ ...EMPTY_REHEARSAL_INPUT, date: todayInTokyo() });
  const [bulkDates, setBulkDates] = useState([todayInTokyo()]);
  const [editing, setEditing] = useState<Rehearsal | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<ScheduleView>("list");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await getProjectRehearsals(projectId);
      setUpcoming(result.upcoming);
      setPast(result.past);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "稽古予定を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void getProjectRehearsals(projectId)
      .then((result) => {
        if (!active) return;
        setUpcoming(result.upcoming);
        setPast(result.past);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "稽古予定を読み込めませんでした");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const timelineModel = useMemo(() => buildRehearsalPrintModel(upcoming), [upcoming]);

  const openSingle = () => {
    setDraft({ ...EMPTY_REHEARSAL_INPUT, date: todayInTokyo() });
    setEditing(null); setMode("single"); setFormError(""); setConflict(false);
  };
  const openBulk = () => {
    setDraft({ ...EMPTY_REHEARSAL_INPUT, date: "" });
    setBulkDates([todayInTokyo()]);
    setEditing(null); setMode("bulk"); setFormError(""); setConflict(false);
  };
  const openEdit = (item: Rehearsal) => {
    setEditing(item); setDraft(rehearsalToInput(item)); setMode("edit"); setFormError(""); setConflict(false);
  };

  const closeEditor = () => { if (!saving) { setMode(null); setEditing(null); setConflict(false); setFormError(""); } };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true); setFormError(""); setConflict(false); setNotice("");
    try {
      if (mode === "edit" && editing) {
        await updateProjectRehearsal(db, projectId, editing.id, draft, { actor, expectedRevision: editing.revision });
        setNotice("稽古予定を更新しました");
      } else if (mode === "bulk") {
        const shared = {
          startTime: draft.startTime,
          endTime: draft.endTime,
          type: draft.type,
          customType: draft.customType,
          venue: draft.venue,
          content: draft.content,
          note: draft.note,
        };
        const count = await createProjectRehearsals(projectId, bulkDates, shared, actor);
        setNotice(`${count}件の稽古予定を追加しました`);
      } else {
        await createProjectRehearsal(projectId, draft, actor);
        setNotice("稽古予定を追加しました");
      }
      setMode(null); setEditing(null);
      await load();
    } catch (error) {
      if (isConflictError(error)) setConflict(true);
      else setFormError(error instanceof Error ? error.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  const reloadConflict = async () => {
    if (!editing || !confirm("未保存の入力内容を破棄し、最新の内容を読み込みますか？")) return;
    setSaving(true); setFormError("");
    try {
      const latest = await getProjectRehearsal(projectId, editing.id);
      if (!latest) throw new Error("稽古予定が削除されています");
      setEditing(latest); setDraft(rehearsalToInput(latest)); setConflict(false);
      await load();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "最新の内容を読み込めませんでした");
    } finally { setSaving(false); }
  };

  const remove = async (item: Rehearsal) => {
    if (!canEdit || !confirm(`${formatDate(item)} ${formatTime(item)} の稽古予定を削除しますか？`)) return;
    setLoadError(""); setNotice("");
    try {
      await deleteProjectRehearsal(db, projectId, item.id, { actor, expectedRevision: item.revision });
      setNotice("稽古予定を削除しました");
      await load();
    } catch (error) {
      setLoadError(isConflictError(error) ? `${CONFLICT_MESSAGE} 一覧を再読み込みしてください。` : error instanceof Error ? error.message : "削除できませんでした");
    }
  };

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><Link href={`/projects/${projectId}`}>← 公演トップ</Link><p>REHEARSAL SCHEDULE</p><h1>稽古スケジュール</h1></div>
        <div className={styles.headerActions}>
          {canEdit && <>
            <button type="button" onClick={openSingle}>＋ 稽古を追加</button>
            <button className={styles.secondaryButton} type="button" onClick={openBulk}>複数日追加</button>
            {canImport && canUseRehearsalScreenshotImport(role) && <RehearsalImportDialog
              projectId={projectId}
              existingRehearsals={[...upcoming, ...past]}
              onImported={async (count) => { setNotice(`${count}件の稽古予定を追加しました`); await load(); }}
            />}
          </>}
          <Link className={styles.actionLink} href={`/projects/${projectId}/rehearsals/print`}>印刷</Link>
          <details className={styles.attendanceMenu}><summary>出欠</summary><div><Link href={`/projects/${projectId}/attendance`}>出欠入力</Link><Link href={`/projects/${projectId}/attendance/manage`}>全体出欠</Link></div></details>
        </div>
      </header>

      {notice && <p className={styles.success} role="status">{notice}</p>}
      {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={() => void load()}>再読み込み</button></p>}

      <div className={styles.viewSwitch} role="group" aria-label="稽古予定の表示形式"><button type="button" data-selected={view === "list"} onClick={() => setView("list")}>一覧</button><button type="button" data-selected={view === "timeline"} onClick={() => setView("timeline")}>時間軸</button></div>

      {view === "list" ? <>
        <section className={styles.schedule} aria-labelledby="upcoming-title">
          <div className={styles.sectionTitle}><p>UPCOMING</p><h2 id="upcoming-title">今後の稽古</h2><span>{upcoming.length}件</span></div>
          {!loading && upcoming.length === 0 ? <p className={styles.empty}>登録されている今後の稽古はありません。</p> : <RehearsalRows items={upcoming} canEdit={canEdit} onEdit={openEdit} onDelete={remove} />}
        </section>

        <details className={styles.pastSection}>
          <summary>過去の稽古 <span>{past.length}件</span></summary>
          {past.length === 0 ? <p className={styles.empty}>過去の稽古はありません。</p> : <RehearsalRows items={past} canEdit={canEdit} onEdit={openEdit} onDelete={remove} />}
        </details>
      </> : <section className={styles.timelineSection} aria-labelledby="timeline-title">
        <div className={styles.sectionTitle}><p>TIMELINE</p><h2 id="timeline-title">今後の稽古時間軸</h2><span>{timelineModel.days.length}日</span></div>
        {loading ? <p className={styles.empty}>読み込み中…</p> : timelineModel.rehearsalCount === 0 ? <p className={styles.empty}>登録されている今後の稽古はありません。</p> : <RehearsalTimeline model={timelineModel} onSelect={canEdit ? (id) => { const item = upcoming.find((rehearsal) => rehearsal.id === id); if (item) openEdit(item); } : undefined} />}
      </section>}

      {mode && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeEditor(); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="editor-title"><header><div><p>REHEARSAL</p><h2 id="editor-title">{mode === "edit" ? "稽古を編集" : mode === "bulk" ? "複数日追加" : "稽古を追加"}</h2></div><button aria-label="閉じる" type="button" onClick={closeEditor}>×</button></header><form onSubmit={save}>
        {mode === "bulk" && <fieldset className={styles.dateList}><legend>日付 *</legend>{bulkDates.map((date, index) => <div key={index}><input required type="date" value={date} onChange={(event) => setBulkDates((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><button disabled={bulkDates.length === 1} type="button" onClick={() => setBulkDates((current) => current.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div>)}<button type="button" disabled={bulkDates.length >= 100} onClick={() => setBulkDates((current) => [...current, ""])}>＋ 日付を追加</button><small>同じ日付は1件として登録します（最大100件）</small></fieldset>}
        <RehearsalFields value={draft} onChange={setDraft} hideDate={mode === "bulk"} />
        {conflict && <div className={styles.conflict} role="alert"><strong>他のメンバーによる更新があります</strong><p>{CONFLICT_MESSAGE}</p><button type="button" disabled={saving} onClick={() => void reloadConflict()}>最新の内容を読み込む</button></div>}
        {formError && <p className={styles.formError} role="alert">{formError}</p>}
        <footer><button className={styles.secondaryButton} type="button" onClick={closeEditor}>キャンセル</button><button type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button></footer>
      </form></section></div>}
    </main>
  );
}
