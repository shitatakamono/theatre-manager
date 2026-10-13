"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./project-list.module.css";

type ProjectSummary = { id: string; title: string };
type DialogState =
  | { type: "rename"; project: ProjectSummary }
  | { type: "delete"; project: ProjectSummary }
  | null;

export function ProjectListClient({ initialProjects }: { initialProjects: ProjectSummary[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!openMenuId) return;
    const close = () => setOpenMenuId(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [openMenuId]);

  function openDialog(nextDialog: Exclude<DialogState, null>) {
    setDialog(nextDialog);
    setTitle(nextDialog.project.title);
    setError("");
    setOpenMenuId(null);
  }

  function closeDialog() {
    if (saving) return;
    setDialog(null);
    setError("");
  }

  async function rename() {
    if (!dialog || dialog.type !== "rename") return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError("公演名を入力してください");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${dialog.project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "公演名を変更できませんでした");
      setProjects((current) => current.map((project) =>
        project.id === dialog.project.id ? { ...project, title: nextTitle } : project
      ));
      setDialog(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "公演名を変更できませんでした");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!dialog || dialog.type !== "delete") return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${dialog.project.id}`, { method: "DELETE" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error || "公演を削除できませんでした");
      setProjects((current) => current.filter((project) => project.id !== dialog.project.id));
      setDialog(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "公演を削除できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p>SEISAKU BOARD</p><h1>公演一覧</h1></div>
        <Link className={styles.createButton} href="/projects/new">公演を作成する</Link>
      </header>
      {projects.length === 0 ? <p className={styles.empty}>まだ公演がありません。</p> : (
        <ul className={styles.list}>{projects.map((project) => (
          <li className={styles.card} data-menu-open={openMenuId === project.id} key={project.id}>
            <Link className={styles.cardLink} href={`/projects/${project.id}`}>
              <span>公演</span><strong>{project.title}</strong><small>制作ロードマップを見る →</small>
            </Link>
            <div className={styles.actionArea}>
              <button className={styles.menuButton} type="button" aria-label={`${project.title}の操作メニュー`} aria-expanded={openMenuId === project.id} onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === project.id ? null : project.id); }}>…</button>
              {openMenuId === project.id && <div className={styles.menu} role="menu" onClick={(event) => event.stopPropagation()}>
                <button type="button" role="menuitem" onClick={() => openDialog({ type: "rename", project })}>公演名を変更</button>
                <button className={styles.deleteMenuItem} type="button" role="menuitem" onClick={() => openDialog({ type: "delete", project })}>削除</button>
              </div>}
            </div>
          </li>
        ))}</ul>
      )}
      {dialog && <div className={styles.dialogLayer} role="presentation" onMouseDown={closeDialog}>
        <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="project-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
          {dialog.type === "rename" ? <>
            <h2 id="project-dialog-title">公演名を変更</h2>
            <p>公演一覧で使用する管理名を変更します。公演情報内の正式名称には影響しません。</p>
            <label className={styles.field}><span>公演名</span><input autoFocus maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          </> : <>
            <h2 id="project-dialog-title">「{dialog.project.title}」を削除しますか？</h2>
            <p>この公演に登録されている制作情報やタスクも削除されます。この操作は元に戻せません。</p>
          </>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <footer className={styles.dialogActions}>
            <button type="button" onClick={closeDialog} disabled={saving}>キャンセル</button>
            <button className={dialog.type === "delete" ? styles.dangerButton : styles.primaryButton} type="button" onClick={dialog.type === "rename" ? rename : remove} disabled={saving}>{saving ? "処理中…" : dialog.type === "rename" ? "変更する" : "削除する"}</button>
          </footer>
        </section>
      </div>}
    </main>
  );
}
