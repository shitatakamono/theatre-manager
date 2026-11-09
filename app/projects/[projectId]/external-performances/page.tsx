"use client";

import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import { db } from "@/lib/firebase";
import { isConflictError } from "@/lib/project-revisions";
import {
  createProjectExternalPerformance, deleteProjectExternalPerformance,
  getProjectExternalPerformances, updateProjectExternalPerformance,
} from "@/lib/external-performance-store";
import {
  EMPTY_EXTERNAL_PERFORMANCE_INPUT, EMPTY_INSERTION_INPUT,
  INSERTION_METHOD_OPTIONS, INSERTION_STATUS_OPTIONS,
  externalPerformanceToInput, filterExternalPerformances,
  getInsertionDateTimeLabel, getInsertionStatusLabel, getInsertionSummary,
  type ExternalPerformance, type ExternalPerformanceFilter, type ExternalPerformanceInput,
  type InsertionMethod, type InsertionStatus,
} from "@/lib/external-performances";
import { useProjectAccess } from "../ProjectAccess";
import styles from "./external-performances.module.css";

type Props = { params: Promise<{ projectId: string }> };
const FILTERS: Array<{ value: ExternalPerformanceFilter; label: string }> = [
  { value: "all", label: "すべて" }, { value: "planned", label: "折込予定あり" },
  { value: "incomplete", label: "折込未完了" }, { value: "completed", label: "折込完了" },
];

function dateRange(item: ExternalPerformance): string {
  if (!item.startDate && !item.endDate) return "日程未定";
  if (!item.endDate || item.startDate === item.endDate) return item.startDate || item.endDate;
  return `${item.startDate || "未定"} 〜 ${item.endDate}`;
}

export default function ExternalPerformancesPage({ params }: Props) {
  const { projectId } = use(params);
  const { canEdit, actor } = useProjectAccess();
  const [items, setItems] = useState<ExternalPerformance[]>([]);
  const [filter, setFilter] = useState<ExternalPerformanceFilter>("all");
  const [editing, setEditing] = useState<ExternalPerformance | null>(null);
  const [draft, setDraft] = useState<ExternalPerformanceInput>(EMPTY_EXTERNAL_PERFORMANCE_INPUT);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getProjectExternalPerformances(projectId)
      .then((records) => { if (active) setItems(records); })
      .catch(() => { if (active) setError("他団体公演の情報を取得できませんでした。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const shown = useMemo(() => filterExternalPerformances(items, filter), [filter, items]);

  function openCreate() {
    setEditing(null); setDraft(EMPTY_EXTERNAL_PERFORMANCE_INPUT); setError(""); setOpen(true);
  }
  function openEdit(item: ExternalPerformance, addInsertion = false) {
    if (!canEdit) return;
    const input = externalPerformanceToInput(item);
    setEditing(item); setDraft(addInsertion && !input.insertion ? { ...input, insertion: { ...EMPTY_INSERTION_INPUT } } : input);
    setError(""); setOpen(true);
  }
  function closeEditor() { if (!saving) { setOpen(false); setEditing(null); } }

  async function reload() {
    setItems(await getProjectExternalPerformances(projectId));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true); setError("");
    try {
      if (editing) {
        await updateProjectExternalPerformance(db, projectId, editing.id, draft, { actor, expectedRevision: editing.revision });
      } else {
        await createProjectExternalPerformance(projectId, draft, actor);
      }
      await reload(); closeEditor();
    } catch (caught) {
      setError(isConflictError(caught) ? "別の画面で更新されました。画面を閉じて最新情報を確認してください。" : caught instanceof Error ? caught.message : "保存できませんでした。");
    } finally { setSaving(false); }
  }

  async function removePerformance() {
    if (!editing || !canEdit || saving) return;
    const warning = editing.insertion ? "\n登録済みの折込情報も削除されます。" : "";
    if (!window.confirm(`「${editing.performanceName}」を削除しますか？${warning}\n\nこの操作は取り消せません。`)) return;
    setSaving(true); setError("");
    try {
      await deleteProjectExternalPerformance(db, projectId, editing.id, { actor, expectedRevision: editing.revision });
      await reload(); closeEditor();
    } catch (caught) {
      setError(isConflictError(caught) ? "別の画面で更新されました。最新情報を確認してください。" : "公演情報を削除できませんでした。");
    } finally { setSaving(false); }
  }

  async function removeInsertion() {
    if (!editing || !draft.insertion || saving) return;
    if (!window.confirm("折込情報だけを削除しますか？\n公演情報は残ります。")) return;
    setSaving(true); setError("");
    try {
      await updateProjectExternalPerformance(db, projectId, editing.id, { ...externalPerformanceToInput(editing), insertion: null }, { actor, expectedRevision: editing.revision });
      await reload(); closeEditor();
    } catch (caught) {
      setError(isConflictError(caught) ? "別の画面で更新されました。最新情報を確認してください。" : "折込情報を削除できませんでした。");
    } finally { setSaving(false); }
  }

  return <main className={styles.page}>
    <header className={styles.heading}>
      <div><p>EXTERNAL PERFORMANCES</p><h1>他団体公演・折込</h1><span>他団体の公演情報と、チラシ折込の予定をまとめます。</span></div>
      {canEdit && <button type="button" onClick={openCreate}>＋ 公演情報を追加</button>}
    </header>
    <nav className={styles.filters} aria-label="表示する公演の絞り込み">{FILTERS.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</nav>
    {error && !open && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.empty}>読み込み中…</p> : shown.length === 0 ? <p className={styles.empty}>条件に一致する公演情報はありません。</p> : <>
      <div className={styles.tableWrap}><table><thead><tr><th>団体・公演</th><th>会場</th><th>部数・方法</th><th>折込・受渡日時</th><th>状況</th><th>公演日程</th><th></th></tr></thead><tbody>{shown.map((item) => <tr key={item.id}>
        <td><strong>{item.organizationName}</strong><span>{item.performanceName}</span></td><td>{item.venue || "―"}</td><td>{getInsertionSummary(item.insertion)}</td><td>{getInsertionDateTimeLabel(item.insertion)}</td><td><span className={styles.status} data-status={item.insertion?.status ?? "none"}>{getInsertionStatusLabel(item.insertion)}</span></td><td className={styles.performanceDates}>{dateRange(item)}</td>
        <td>{canEdit && <div className={styles.rowActions}><button type="button" onClick={() => openEdit(item)}>公演情報を編集</button><button type="button" onClick={() => openEdit(item, !item.insertion)}>{item.insertion ? "折込情報を編集" : "この公演に折込する"}</button></div>}</td>
      </tr>)}</tbody></table></div>
      <div className={styles.cards}>{shown.map((item) => <article key={item.id}><header><div><small>{item.organizationName}</small><h2>{item.performanceName}</h2></div><span className={styles.status} data-status={item.insertion?.status ?? "none"}>{getInsertionStatusLabel(item.insertion)}</span></header><dl><div><dt>折込</dt><dd>{getInsertionSummary(item.insertion)}</dd></div><div><dt>日時</dt><dd>{getInsertionDateTimeLabel(item.insertion)}</dd></div><div><dt>会場</dt><dd>{item.venue || "―"}</dd></div><div className={styles.performanceDates}><dt>公演日</dt><dd>{dateRange(item)}</dd></div></dl>{canEdit && <div className={styles.cardActions}><button type="button" onClick={() => openEdit(item)}>公演情報を編集</button><button type="button" onClick={() => openEdit(item, !item.insertion)}>{item.insertion ? "折込情報を編集" : "この公演に折込する"}</button></div>}</article>)}</div>
    </>}

    {open && canEdit && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) closeEditor(); }}>
      <form className={styles.editor} onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="external-performance-editor-title">
        <header><div><p>EXTERNAL PERFORMANCE</p><h2 id="external-performance-editor-title">{editing ? "公演情報を編集" : "公演情報を追加"}</h2></div><button type="button" aria-label="閉じる" onClick={closeEditor}>×</button></header>
        <div className={styles.formGrid}>
          <label><span>団体名 *</span><input autoFocus required maxLength={200} value={draft.organizationName} onChange={(event) => setDraft({ ...draft, organizationName: event.target.value })} /></label>
          <label><span>公演名 *</span><input required maxLength={200} value={draft.performanceName} onChange={(event) => setDraft({ ...draft, performanceName: event.target.value })} /></label>
          <label><span>開始日</span><input type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label>
          <label><span>終了日</span><input type="date" value={draft.endDate} onChange={(event) => setDraft({ ...draft, endDate: event.target.value })} /></label>
          <label className={styles.wide}><span>会場</span><input maxLength={300} value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} /></label>
          <label><span>連絡先</span><input maxLength={300} value={draft.contact} onChange={(event) => setDraft({ ...draft, contact: event.target.value })} /></label>
          <label><span>連絡方法</span><input maxLength={200} placeholder="例：メール、電話" value={draft.contactMethod} onChange={(event) => setDraft({ ...draft, contactMethod: event.target.value })} /></label>
          <label className={styles.wide}><span>連絡担当</span><input maxLength={200} value={draft.contactPerson} onChange={(event) => setDraft({ ...draft, contactPerson: event.target.value })} /></label>
          <label className={styles.wide}><span>備考</span><textarea rows={3} maxLength={3000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
        </div>
        <section className={styles.insertion}>
          <header><div><h3>チラシ折込</h3><p>折込を予定する場合だけ入力してください。</p></div>{!draft.insertion && <button type="button" onClick={() => setDraft({ ...draft, insertion: { ...EMPTY_INSERTION_INPUT } })}>折込情報を追加</button>}</header>
          {draft.insertion && <div className={styles.formGrid}>
            <label><span>方法</span><select value={draft.insertion.method} onChange={(event) => setDraft({ ...draft, insertion: { ...draft.insertion!, method: event.target.value as InsertionMethod } })}>{INSERTION_METHOD_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label><span>部数</span><input type="number" min={1} max={1000000} step={1} placeholder="未定の場合は空欄" value={draft.insertion.quantity} onChange={(event) => setDraft({ ...draft, insertion: { ...draft.insertion!, quantity: event.target.value } })} /></label>
            <label><span>状況</span><select value={draft.insertion.status} onChange={(event) => setDraft({ ...draft, insertion: { ...draft.insertion!, status: event.target.value as InsertionStatus } })}>{INSERTION_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className={styles.wide}><span>折込・受渡日時</span><input maxLength={200} placeholder="例：11/20 18時頃、11/20までに持込、開演前まで" value={draft.insertion.dateTimeText} onChange={(event) => setDraft({ ...draft, insertion: { ...draft.insertion!, dateTimeText: event.target.value } })} /><small>折込作業や持込の日時を入力します。郵送の必着指定は下の「到着日時指定」へ入力してください。</small></label>
            {draft.insertion.method === "postal" && <><label className={styles.wide}><span>郵送先住所</span><input maxLength={500} value={draft.insertion.postalAddress} onChange={(event) => setDraft({ ...draft, insertion: { ...draft.insertion!, postalAddress: event.target.value } })} /></label><label><span>宛名</span><input maxLength={200} value={draft.insertion.postalRecipient} onChange={(event) => setDraft({ ...draft, insertion: { ...draft.insertion!, postalRecipient: event.target.value } })} /></label><label><span>到着日時指定</span><input maxLength={200} placeholder="例：11/20必着、午前指定" value={draft.insertion.postalArrivalText} onChange={(event) => setDraft({ ...draft, insertion: { ...draft.insertion!, postalArrivalText: event.target.value } })} /></label></>}
            <label className={styles.wide}><span>折込メモ</span><textarea rows={2} maxLength={2000} value={draft.insertion.note} onChange={(event) => setDraft({ ...draft, insertion: { ...draft.insertion!, note: event.target.value } })} /></label>
            <div className={styles.removeInsertion}>{editing?.insertion ? <button type="button" onClick={removeInsertion} disabled={saving}>折込情報だけ削除</button> : <button type="button" onClick={() => setDraft({ ...draft, insertion: null })}>折込入力を取り消す</button>}</div>
          </div>}
        </section>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <footer><div>{editing && <button className={styles.deleteButton} type="button" disabled={saving} onClick={removePerformance}>この公演情報を削除</button>}</div><div><button type="button" onClick={closeEditor} disabled={saving}>キャンセル</button><button className={styles.saveButton} type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button></div></footer>
      </form>
    </div>}
  </main>;
}
