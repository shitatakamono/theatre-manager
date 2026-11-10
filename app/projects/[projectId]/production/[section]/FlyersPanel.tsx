"use client";

import { useEffect, useMemo, useState } from "react";
import { db } from "@/lib/firebase";
import {
  copyLegacyProjectFlyer,
  copyProjectFlyer,
  createProjectFlyer,
  deleteProjectFlyer,
  getProjectFlyers,
  updateProjectFlyer,
} from "@/lib/flyer-store";
import {
  buildLegacyFlyer,
  EMPTY_FLYER_INPUT,
  flyerToInput,
  type Flyer,
  type FlyerInput,
  type LegacyFlyer,
} from "@/lib/flyers";
import type { PrintItemManagement } from "@/lib/production-management";
import { isConflictError } from "@/lib/project-revisions";
import { useProjectAccess } from "../../ProjectAccess";
import {
  CheckboxField,
  DetailList,
  EditorDrawer,
  Field,
  displayValue,
  numberOrUndefined,
  styles,
} from "./ProductionCommon";

type DisplayFlyer = Flyer | LegacyFlyer;

function isLegacy(flyer: DisplayFlyer): flyer is LegacyFlyer {
  return "legacy" in flyer && flyer.legacy;
}

function printSummary(flyer: FlyerInput): string {
  return [
    flyer.size,
    flyer.sides === "single" ? "片面" : flyer.sides === "double" ? "両面" : "",
    flyer.quantity !== undefined ? `${flyer.quantity.toLocaleString("ja-JP")}部` : "",
  ].filter(Boolean).join(" / ") || "未設定";
}

export function FlyersPanel({
  projectId,
  legacyFlyer,
  onEditLegacy,
}: {
  projectId: string;
  legacyFlyer?: PrintItemManagement;
  onEditLegacy: () => void;
}) {
  const { canEdit, actor } = useProjectAccess();
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [editing, setEditing] = useState<Flyer | null>(null);
  const [draft, setDraft] = useState<FlyerInput>({ ...EMPTY_FLYER_INPUT });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const legacy = useMemo(() => buildLegacyFlyer(legacyFlyer), [legacyFlyer]);
  const displayed: DisplayFlyer[] = [legacy, ...flyers];

  useEffect(() => {
    let active = true;
    void getProjectFlyers(projectId)
      .then((records) => { if (active) setFlyers(records); })
      .catch(() => { if (active) setError("チラシを取得できませんでした。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function reload() {
    setFlyers(await getProjectFlyers(projectId));
  }

  function openCreate() {
    if (!canEdit) return;
    setEditing(null);
    setDraft({ ...EMPTY_FLYER_INPUT });
    setError("");
    setMessage("");
    setOpen(true);
  }

  function openEdit(flyer: Flyer) {
    if (!canEdit) return;
    setEditing(flyer);
    setDraft(flyerToInput(flyer));
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
        await updateProjectFlyer(db, projectId, editing.id, draft, { actor, expectedRevision: editing.revision });
      } else {
        await createProjectFlyer(projectId, draft, actor, db);
      }
      await reload();
      setOpen(false);
      setEditing(null);
      setMessage(editing ? "チラシを更新しました。" : "チラシを追加しました。");
    } catch (caught) {
      setError(isConflictError(caught)
        ? "別の画面で更新されました。画面を閉じて最新情報を確認してください。"
        : caught instanceof Error ? caught.message : "保存できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function duplicate(flyer: DisplayFlyer) {
    if (!canEdit || saving) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      if (isLegacy(flyer)) {
        await copyLegacyProjectFlyer(projectId, flyer, actor, db);
      } else {
        await copyProjectFlyer(db, projectId, flyer.id, actor);
      }
      await reload();
      setMessage("コピーを新しいチラシとして追加しました。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "チラシをコピーできませんでした。");
    } finally {
      setSaving(false);
    }
  }

  async function remove(flyer: Flyer) {
    if (!canEdit || saving) return;
    if (!window.confirm(`「${flyer.name}」を削除しますか？\n\nこの操作は取り消せません。`)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await deleteProjectFlyer(db, projectId, flyer.id, { actor, expectedRevision: flyer.revision });
      await reload();
      setMessage("チラシを削除しました。");
    } catch (caught) {
      setError(isConflictError(caught)
        ? "別の画面で更新されました。最新情報を確認してください。"
        : "チラシを削除できませんでした。");
    } finally {
      setSaving(false);
    }
  }

  return <>
    <section className={styles.section} id="flyer">
      <header className={styles.sectionHeader}>
        <div><h2>チラシ</h2><p className={styles.description}>用途ごとに、仕様・印刷・入稿・納品を分けて管理します。</p></div>
        {canEdit && <button type="button" onClick={openCreate} disabled={saving}>＋ チラシを追加</button>}
      </header>
      {message && <p className={styles.successMessage}>{message}</p>}
      {error && !open && <p className={styles.inlineError} role="alert">{error}</p>}
      {loading ? <p className={styles.empty}>読み込み中…</p> :
        <ul className={styles.variantList}>{displayed.map((flyer) => <li key={flyer.id} className={styles.flyerItem}>
          <div className={styles.flyerMain}>
            <div className={styles.variantTitle}><strong>{flyer.name}</strong>{isLegacy(flyer) && <span>既存のチラシ</span>}</div>
            <p className={styles.flyerUsage} data-enabled={flyer.enabled}>{flyer.enabled ? "使用する" : "使用しない"}</p>
            <DetailList items={[
              { label: "仕様・部数", value: printSummary(flyer) },
              { label: "印刷業者", value: displayValue(flyer.printer) },
              { label: "入稿", value: `${displayValue(flyer.submissionPlannedDate)}（予定） / ${displayValue(flyer.submissionDate)}（実績）` },
              { label: "納品", value: `${displayValue(flyer.deliveryPlannedDate)}（予定） / ${displayValue(flyer.deliveryDate)}（実績）` },
              { label: "印刷費", value: flyer.printCost === undefined ? "未設定" : `${flyer.printCost.toLocaleString("ja-JP")}円` },
            ]} />
          </div>
          {canEdit && <div className={styles.variantActions}>
            <button type="button" onClick={() => isLegacy(flyer) ? onEditLegacy() : openEdit(flyer)} disabled={saving}>編集</button>
            <button type="button" onClick={() => void duplicate(flyer)} disabled={saving}>複製</button>
            {!isLegacy(flyer) && <button className={styles.dangerButton} type="button" onClick={() => void remove(flyer)} disabled={saving}>削除</button>}
          </div>}
        </li>)}</ul>}
    </section>
    {open && canEdit && <EditorDrawer title={editing ? "チラシを編集" : "チラシを追加"} saving={saving} error={error} onClose={close} onSave={() => void save()}>
      <FlyerFields value={draft} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} />
    </EditorDrawer>}
  </>;
}

export function FlyerFields({ value, onChange }: { value: FlyerInput; onChange: (patch: Partial<FlyerInput>) => void }) {
  return <div className={styles.formGrid}>
    <Field label="チラシ名" value={value.name} onChange={(name) => onChange({ name })} />
    <CheckboxField label="チラシを使用する" checked={value.enabled} onChange={(enabled) => onChange({ enabled })} />
    <Field label="サイズ" value={value.size ?? ""} onChange={(size) => onChange({ size })} />
    <label className={styles.field}><span>片面・両面</span><select value={value.sides ?? ""} onChange={(event) => onChange({ sides: event.target.value as FlyerInput["sides"] })}><option value="">未設定</option><option value="single">片面</option><option value="double">両面</option></select></label>
    <Field label="部数" type="number" min={1} value={value.quantity ?? ""} onChange={(quantity) => onChange({ quantity: numberOrUndefined(quantity) })} />
    <Field label="印刷業者" value={value.printer ?? ""} onChange={(printer) => onChange({ printer })} />
    <Field label="入稿予定日" type="date" value={value.submissionPlannedDate ?? ""} onChange={(submissionPlannedDate) => onChange({ submissionPlannedDate })} />
    <Field label="入稿日" type="date" value={value.submissionDate ?? ""} onChange={(submissionDate) => onChange({ submissionDate })} />
    <Field label="納品予定日" type="date" value={value.deliveryPlannedDate ?? ""} onChange={(deliveryPlannedDate) => onChange({ deliveryPlannedDate })} />
    <Field label="納品日" type="date" value={value.deliveryDate ?? ""} onChange={(deliveryDate) => onChange({ deliveryDate })} />
    <Field label="印刷費" type="number" min={0} value={value.printCost ?? ""} onChange={(printCost) => onChange({ printCost: numberOrUndefined(printCost) })} />
  </div>;
}
