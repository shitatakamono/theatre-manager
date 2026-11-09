"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import {
  copyProjectFlyerVariant,
  createProjectFlyerVariant,
  deleteProjectFlyerVariant,
  getProjectFlyerVariants,
  updateProjectFlyerVariant,
} from "@/lib/flyer-variant-store";
import {
  buildFlyerVariantCopyInput,
  buildLegacyFlyerVariant,
  EMPTY_FLYER_VARIANT_INPUT,
  FLYER_VARIANT_STATUS_OPTIONS,
  flyerVariantToInput,
  getFlyerVariantStatusLabel,
  type FlyerVariant,
  type FlyerVariantInput,
  type LegacyFlyerVariant,
} from "@/lib/flyer-variants";
import type { PrintItemManagement } from "@/lib/production-management";
import { isConflictError } from "@/lib/project-revisions";
import { useProjectAccess } from "../../ProjectAccess";
import { EditorDrawer, Field, TextareaField, styles } from "./ProductionCommon";

type DisplayVariant = FlyerVariant | LegacyFlyerVariant;

function formatUpdatedAt(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value) || typeof value.toDate !== "function") return "―";
  return value.toDate().toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
}

function isLegacy(variant: DisplayVariant): variant is LegacyFlyerVariant {
  return "legacy" in variant && variant.legacy;
}

export function FlyerVariantsPanel({ projectId, legacyFlyer }: { projectId: string; legacyFlyer?: PrintItemManagement }) {
  const { canEdit, actor } = useProjectAccess();
  const [variants, setVariants] = useState<FlyerVariant[]>([]);
  const [editing, setEditing] = useState<FlyerVariant | null>(null);
  const [draft, setDraft] = useState<FlyerVariantInput>(EMPTY_FLYER_VARIANT_INPUT);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const legacy = useMemo(() => buildLegacyFlyerVariant(legacyFlyer), [legacyFlyer]);
  const displayed: DisplayVariant[] = legacy ? [legacy, ...variants] : variants;

  useEffect(() => {
    let active = true;
    void getProjectFlyerVariants(projectId)
      .then((records) => { if (active) setVariants(records); })
      .catch(() => { if (active) setError("チラシパターンを取得できませんでした。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function reload() {
    setVariants(await getProjectFlyerVariants(projectId));
  }

  function openCreate() {
    if (!canEdit) return;
    setEditing(null);
    setDraft({ ...EMPTY_FLYER_VARIANT_INPUT });
    setError("");
    setMessage("");
    setOpen(true);
  }

  function openEdit(variant: FlyerVariant) {
    if (!canEdit) return;
    setEditing(variant);
    setDraft(flyerVariantToInput(variant));
    setError("");
    setMessage("");
    setOpen(true);
  }

  function close() {
    if (saving) return;
    setOpen(false);
    setEditing(null);
    setError("");
  }

  async function save() {
    if (!canEdit || saving) return;
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await updateProjectFlyerVariant(db, projectId, editing.id, draft, { actor, expectedRevision: editing.revision });
      } else {
        await createProjectFlyerVariant(projectId, draft, actor, db);
      }
      await reload();
      setOpen(false);
      setEditing(null);
      setMessage(editing ? "チラシパターンを更新しました。" : "チラシパターンを追加しました。");
    } catch (caught) {
      setError(isConflictError(caught)
        ? "別の画面で更新されました。画面を閉じて最新情報を確認してください。"
        : caught instanceof Error ? caught.message : "保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function copyVariant(variant: DisplayVariant) {
    if (!canEdit || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (isLegacy(variant)) {
        await createProjectFlyerVariant(projectId, buildFlyerVariantCopyInput(variant), actor, db);
      } else {
        await copyProjectFlyerVariant(db, projectId, variant.id, actor);
      }
      await reload();
      setMessage("コピーを新しいパターンとして追加しました。");
    } catch {
      setError("チラシパターンをコピーできませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function remove(variant: FlyerVariant) {
    if (!canEdit || saving) return;
    if (!window.confirm(`「${variant.name}」を削除しますか？\n\nこの操作は取り消せません。`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteProjectFlyerVariant(db, projectId, variant.id, { actor, expectedRevision: variant.revision });
      await reload();
      setMessage("チラシパターンを削除しました。");
    } catch (caught) {
      setError(isConflictError(caught)
        ? "別の画面で更新されました。最新情報を確認してください。"
        : "チラシパターンを削除できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <section className={styles.section} id="flyer-variants">
      <header className={styles.sectionHeader}>
        <div><h2>チラシパターン</h2><p className={styles.description}>複数のデザイン案を、チラシ全体の制作情報とは分けて管理します。</p></div>
        {canEdit && <button type="button" onClick={openCreate} disabled={saving}>＋ 追加</button>}
      </header>
      {message && <p className={styles.successMessage}>{message}</p>}
      {error && !open && <p className={styles.inlineError} role="alert">{error}</p>}
      {loading ? <p className={styles.empty}>読み込み中…</p> : displayed.length === 0 ? <p className={styles.empty}>チラシパターンはまだありません。</p> :
        <ul className={styles.variantList}>{displayed.map((variant) => <li key={variant.id} className={styles.variantItem}>
          <div className={styles.variantMain}>
            <div className={styles.variantTitle}><strong>{variant.name}</strong>{isLegacy(variant) && <span>既存のチラシ情報</span>}<em data-status={variant.status}>{getFlyerVariantStatusLabel(variant.status)}</em></div>
            {variant.note && <p>{variant.note}</p>}
            <small>更新：{isLegacy(variant) ? "チラシ情報に連動" : formatUpdatedAt(variant.updatedAt)}</small>
          </div>
          {canEdit && <div className={styles.variantActions}>
            {!isLegacy(variant) && <button type="button" onClick={() => openEdit(variant)} disabled={saving}>編集</button>}
            <button type="button" onClick={() => void copyVariant(variant)} disabled={saving}>コピー</button>
            {!isLegacy(variant) && <button className={styles.dangerButton} type="button" onClick={() => void remove(variant)} disabled={saving}>削除</button>}
          </div>}
        </li>)}</ul>}
    </section>
    {open && canEdit && <EditorDrawer title={editing ? "チラシパターン" : "チラシパターンを追加"} saving={saving} error={error} onClose={close} onSave={() => void save()}>
      <div className={styles.formGrid}>
        <Field label="パターン名" value={draft.name} onChange={(name) => setDraft((current) => ({ ...current, name }))} />
        <label className={styles.field}><span>状態</span><select value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value as FlyerVariantInput["status"] }))}>{FLYER_VARIANT_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <TextareaField label="メモ" value={draft.note} onChange={(note) => setDraft((current) => ({ ...current, note }))} rows={5} />
      </div>
    </EditorDrawer>}
  </>;
}
