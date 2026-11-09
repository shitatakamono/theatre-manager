"use client";

import { use, useEffect, useState, type FormEvent } from "react";
import { db } from "@/lib/firebase";
import {
  createProjectProductionAsset, deleteProjectProductionAsset,
  getProjectProductionAssets, updateProjectProductionAsset,
} from "@/lib/production-asset-store";
import {
  EMPTY_PRODUCTION_ASSET_INPUT, PRODUCTION_ASSET_TYPE_OPTIONS,
  getProductionAssetTypeLabel, productionAssetToInput,
  type ProductionAsset, type ProductionAssetInput, type ProductionAssetType,
} from "@/lib/production-assets";
import { isConflictError } from "@/lib/project-revisions";
import { useProjectAccess } from "../ProjectAccess";
import styles from "./production-assets.module.css";

type Props = { params: Promise<{ projectId: string }> };

function formatUpdatedAt(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value) || typeof value.toDate !== "function") return "―";
  return value.toDate().toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

export default function ProductionAssetsPage({ params }: Props) {
  const { projectId } = use(params);
  const { canEdit, actor } = useProjectAccess();
  const [items, setItems] = useState<ProductionAsset[]>([]);
  const [editing, setEditing] = useState<ProductionAsset | null>(null);
  const [draft, setDraft] = useState<ProductionAssetInput>(EMPTY_PRODUCTION_ASSET_INPUT);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getProjectProductionAssets(projectId)
      .then((records) => { if (active) setItems(records); })
      .catch(() => { if (active) setError("制作素材を取得できませんでした。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function reload() { setItems(await getProjectProductionAssets(projectId)); }
  function openCreate() {
    if (!canEdit) return;
    setEditing(null); setDraft({ ...EMPTY_PRODUCTION_ASSET_INPUT }); setError(""); setOpen(true);
  }
  function openEdit(item: ProductionAsset) {
    if (!canEdit) return;
    setEditing(item); setDraft(productionAssetToInput(item)); setError(""); setOpen(true);
  }
  function close() { if (!saving) { setOpen(false); setEditing(null); setError(""); } }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit || saving) return;
    setSaving(true); setError("");
    try {
      if (editing) await updateProjectProductionAsset(db, projectId, editing.id, draft, { actor, expectedRevision: editing.revision });
      else await createProjectProductionAsset(projectId, draft, actor, db);
      await reload(); close();
    } catch (caught) {
      setError(isConflictError(caught)
        ? "別の画面で更新されました。画面を閉じて最新情報を確認してください。"
        : caught instanceof Error ? caught.message : "素材情報を保存できませんでした。");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!editing || !canEdit || saving) return;
    if (!window.confirm(`「${editing.name}」の素材情報を削除しますか？\n\n保存先にある実ファイルは削除されません。`)) return;
    setSaving(true); setError("");
    try {
      await deleteProjectProductionAsset(db, projectId, editing.id, { actor, expectedRevision: editing.revision });
      await reload(); close();
    } catch (caught) {
      setError(isConflictError(caught) ? "別の画面で更新されました。最新情報を確認してください。" : "素材情報を削除できませんでした。");
    } finally { setSaving(false); }
  }

  return <main className={styles.page}>
    <header className={styles.heading}>
      <div><p>PRODUCTION ASSETS</p><h1>制作素材</h1><span>ロゴや写真など、制作素材の保存場所をまとめます。</span></div>
      {canEdit && <button type="button" onClick={openCreate}>＋ 素材を追加</button>}
    </header>
    {error && !open && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.empty}>読み込み中…</p> : items.length === 0 ? <p className={styles.empty}>登録されている制作素材はありません。</p> : <>
      <div className={styles.tableWrap}><table><thead><tr><th>素材名</th><th>種別</th><th>保存場所</th><th>更新日時</th>{canEdit && <th>操作</th>}</tr></thead><tbody>{items.map((item) => <tr key={item.id}>
        <td><strong>{item.name}</strong>{item.note && <span>{item.note}</span>}</td><td>{getProductionAssetTypeLabel(item.type)}</td>
        <td>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">開く ↗</a> : <em>未登録</em>}</td><td>{formatUpdatedAt(item.updatedAt)}</td>
        {canEdit && <td><button type="button" onClick={() => openEdit(item)}>編集</button></td>}
      </tr>)}</tbody></table></div>
      <div className={styles.cards}>{items.map((item) => <article key={item.id}><header><div><small>{getProductionAssetTypeLabel(item.type)}</small><h2>{item.name}</h2></div>{item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">開く ↗</a> : <em>未登録</em>}</header>{item.note && <p>{item.note}</p>}<footer><span>更新：{formatUpdatedAt(item.updatedAt)}</span>{canEdit && <button type="button" onClick={() => openEdit(item)}>編集</button>}</footer></article>)}</div>
    </>}
    {open && canEdit && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
      <form className={styles.editor} onSubmit={save} role="dialog" aria-modal="true" aria-labelledby="asset-editor-title">
        <header><div><p>PRODUCTION ASSET</p><h2 id="asset-editor-title">{editing ? "素材情報を編集" : "素材を追加"}</h2></div><button type="button" aria-label="閉じる" onClick={close}>×</button></header>
        <div className={styles.formGrid}>
          <label><span>素材名 *</span><input value={draft.name} maxLength={200} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
          <label><span>種別</span><select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as ProductionAssetType }))}>{PRODUCTION_ASSET_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className={styles.wide}><span>保存場所URL（任意）</span><input type="url" placeholder="https://..." value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} /></label>
          <label className={styles.wide}><span>メモ</span><textarea rows={5} maxLength={2000} value={draft.note} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} /></label>
        </div>
        <footer><div>{editing && <button className={styles.deleteButton} type="button" disabled={saving} onClick={() => void remove()}>素材情報を削除</button>}</div><div>{error && <p role="alert">{error}</p>}<button type="button" disabled={saving} onClick={close}>キャンセル</button><button className={styles.saveButton} type="submit" disabled={saving}>{saving ? "保存中…" : "保存"}</button></div></footer>
      </form>
    </div>}
  </main>;
}
