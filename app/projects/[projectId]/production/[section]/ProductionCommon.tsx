"use client";

import Link from "next/link";
import { useState } from "react";
import type { ManagedProductionSection } from "@/lib/production-management";
import { updateProjectProductionBlock } from "@/lib/firestore";
import { isConflictError } from "@/lib/project-revisions";
import { useProjectAccess } from "../../ProjectAccess";
import styles from "./venue-management.module.css";

export { styles };

export function displayValue(value?: string | number): string {
  return value === undefined || value === "" ? "未設定" : String(value);
}

export function numberOrUndefined(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

export function createId(): string {
  return crypto.randomUUID();
}

export function useProductionEditor<
  Section extends ManagedProductionSection,
  Block extends keyof import("@/lib/production-management").ProductionSectionDataMap[Section] & string = keyof import("@/lib/production-management").ProductionSectionDataMap[Section] & string,
>(
  projectId: string,
  section: Section,
  initialData: import("@/lib/production-management").ProductionSectionDataMap[Section],
  initialRevision: number
) {
  const { canEdit, actor } = useProjectAccess();
  const [data, setData] = useState(initialData);
  const [draft, setDraft] = useState(initialData);
  const [active, setActive] = useState<Block | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(initialRevision);
  const [expectedRevision, setExpectedRevision] = useState(initialRevision);
  const [conflict, setConflict] = useState(false);

  function open(block: Block) {
    if (!canEdit) return;
    setDraft(structuredClone(data));
    setError("");
    setMessage("");
    setConflict(false);
    setExpectedRevision(revision);
    setActive(block);
  }

  function close() {
    setActive(null);
    setError("");
    setConflict(false);
  }

  async function save(label: string) {
    if (!active || !canEdit) return;
    setSaving(true);
    setError("");
    setConflict(false);

    try {
      const result = await updateProjectProductionBlock(projectId, section, active, draft[active], {
        actor,
        expectedRevision,
      });
      if (result.changed) {
        setData((current) => ({ ...current, [active]: draft[active] }));
        setRevision(result.revision);
        setExpectedRevision(result.revision);
      }
      setMessage(result.changed ? `${label}を保存しました` : "変更はありません");
      setActive(null);
    } catch (saveError) {
      if (isConflictError(saveError)) setConflict(true);
      setError(saveError instanceof Error ? saveError.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  function reloadLatest() {
    if (confirm("最新の内容を読み込むと、現在入力中の未保存内容は失われます。読み込みますか？")) {
      window.location.reload();
    }
  }

  return { data, draft, setDraft, active, open, close, save, saving, error, conflict, reloadLatest, message };
}

export function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date" | "time" | "datetime-local" | "tel" | "url";
  min?: number;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input type={type} min={min} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function TextareaField({
  label,
  value,
  onChange,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <label className={`${styles.field} ${styles.fullField}`}>
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

export function CheckboxField({
  label,
  checked,
  onChange,
  full = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  full?: boolean;
}) {
  return (
    <label className={`${styles.checkboxField} ${full ? styles.fullField : ""}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function ProductionHeader({
  projectId,
  title,
  sectionTitle,
  eyebrow,
}: {
  projectId: string;
  title: string;
  sectionTitle: string;
  eyebrow: string;
}) {
  return (
    <header className={styles.hero}>
      <div>
        <Link className={styles.backLink} href={`/projects/${projectId}`}>← 制作ロードマップへ戻る</Link>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{sectionTitle}</h1>
        <p className={styles.projectTitle}>{title}</p>
      </div>
      <Link className={styles.infoLink} href={`/projects/${projectId}/info`}>公演情報を見る</Link>
    </header>
  );
}

export function ReferencePanel({
  title = "公演情報から参照",
  items,
}: {
  title?: string;
  items: { label: string; value: React.ReactNode }[];
}) {
  return (
    <section className={styles.venueReference}>
      <p>{title}</p>
      <dl>
        {items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>
    </section>
  );
}

export function SectionNav({ links }: { links: { id: string; label: string }[] }) {
  return (
    <nav className={styles.sectionNav} aria-label="制作管理のセクション">
      {links.map((link) => <a key={link.id} href={`#${link.id}`}>{link.label}</a>)}
    </nav>
  );
}

export function ManagementSection<Block extends string>({
  id,
  title,
  block,
  onEdit,
  editable = true,
  children,
}: {
  id: string;
  title: string;
  block: Block;
  onEdit: (block: Block) => void;
  editable?: boolean;
  children: React.ReactNode;
}) {
  const { canEdit } = useProjectAccess();
  return (
    <section className={styles.section} id={id}>
      <header className={styles.sectionHeader}>
        <h2>{title}</h2>
        {editable && canEdit && <button onClick={() => onEdit(block)}>編集</button>}
      </header>
      {children}
    </section>
  );
}

export function EditorDrawer({
  title,
  saving,
  error,
  conflict = false,
  onReload,
  onClose,
  onSave,
  children,
}: {
  title: string;
  saving: boolean;
  error: string;
  conflict?: boolean;
  onReload?: () => void;
  onClose: () => void;
  onSave: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.drawerLayer} role="presentation">
      <button className={styles.backdrop} aria-label="編集を閉じる" onClick={onClose} />
      <aside className={styles.drawer} aria-label={`${title}を編集`}>
        <header className={styles.drawerHeader}>
          <div><p>制作管理</p><h2>{title}を編集</h2></div>
          <button aria-label="閉じる" onClick={onClose}>×</button>
        </header>
        <div className={styles.drawerBody}>{children}</div>
        <footer className={styles.drawerFooter}>
          {error && (conflict ? <div className={styles.conflictNotice} role="alert"><p>{error}</p>{onReload && <button onClick={onReload}>最新の内容を読み込む</button>}</div> : <p>{error}</p>)}
          <button className={styles.cancelButton} onClick={onClose} disabled={saving}>キャンセル</button>
          <button className={styles.saveButton} onClick={onSave} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
        </footer>
      </aside>
    </div>
  );
}

export function CheckList({ items }: { items: { label: string; complete?: boolean }[] }) {
  return <ul className={styles.checkList}>{items.map((item) => <li key={item.label} data-complete={item.complete}>{item.complete ? "✓" : "–"} {item.label}</li>)}</ul>;
}

export function DetailList({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return <dl className={styles.detailList}>{items.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>;
}
