"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import {
  createRehearsalImportDrafts,
  getRehearsalInputError,
  hasExistingRehearsalDuplicate,
  validateRehearsalImportDrafts,
  type RehearsalImportDraft,
  type RehearsalImportDrafts,
} from "@/lib/rehearsal-import-drafts";
import {
  REHEARSAL_IMPORT_IMAGE_TYPES,
  REHEARSAL_IMPORT_MAX_IMAGE_BYTES,
  type ImportedReservationRow,
  type ImportedReservationWarning,
  type RehearsalImportResponse,
} from "@/lib/rehearsal-import";
import {
  REHEARSAL_TYPE_OPTIONS,
  createProjectRehearsalBatch,
  type Rehearsal,
  type RehearsalInput,
} from "@/lib/rehearsals";
import { useProjectAccess } from "../ProjectAccess";
import styles from "./rehearsals.module.css";

const warningLabels: Record<ImportedReservationWarning, string> = {
  status_unclear: "状況を確認してください",
  date_unreadable: "日付を確認してください",
  era_mismatch: "西暦と和暦が一致しません",
  time_unreadable: "時刻を確認してください",
  venue_missing: "施設名を確認してください",
  low_image_quality: "画像が不鮮明な可能性があります",
};

function ImportFields({ draft, onChange }: {
  draft: RehearsalImportDraft;
  onChange: (input: RehearsalInput) => void;
}) {
  const patch = <Key extends keyof RehearsalInput>(key: Key, value: RehearsalInput[Key]) => {
    onChange({ ...draft.input, [key]: value });
  };
  return (
    <div className={styles.importFormGrid}>
      <label><span>日付 *</span><input type="date" value={draft.input.date} onChange={(event) => patch("date", event.target.value)} /></label>
      <label><span>開始時刻 *</span><input type="time" value={draft.input.startTime} onChange={(event) => patch("startTime", event.target.value)} /></label>
      <label><span>終了時刻</span><input type="time" value={draft.input.endTime} onChange={(event) => patch("endTime", event.target.value)} /></label>
      <label><span>稽古種別 *</span><select value={draft.input.type} onChange={(event) => {
        const type = event.target.value as RehearsalInput["type"];
        onChange({ ...draft.input, type, customType: type === "other" ? draft.input.customType : "" });
      }}>{REHEARSAL_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      {draft.input.type === "other" && <label className={styles.importFull}><span>その他の種別 *</span><input maxLength={100} value={draft.input.customType} onChange={(event) => patch("customType", event.target.value)} /></label>}
      <label className={styles.importFull}><span>場所</span><input maxLength={200} value={draft.input.venue} onChange={(event) => patch("venue", event.target.value)} /></label>
      <label className={styles.importFull}><span>内容</span><textarea rows={2} maxLength={2000} value={draft.input.content} onChange={(event) => patch("content", event.target.value)} /></label>
      <label className={styles.importFull}><span>備考</span><textarea rows={2} maxLength={5000} value={draft.input.note} onChange={(event) => patch("note", event.target.value)} /></label>
    </div>
  );
}

function CancelledRow({ row }: { row: ImportedReservationRow }) {
  return (
    <article className={styles.cancelledRow}>
      <strong>行 {row.sourceRow}　状況：取消</strong>
      <span>{row.date ?? "日付未読取"}　{row.startTime ?? "--:--"}–{row.endTime ?? "--:--"}</span>
      <span>{row.venue ?? "施設名未読取"}</span>
    </article>
  );
}

export function RehearsalImportDialog({ projectId, existingRehearsals, onImported }: {
  projectId: string;
  existingRehearsals: Rehearsal[];
  onImported: (count: number) => Promise<void>;
}) {
  const { actor } = useProjectAccess();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [drafts, setDrafts] = useState<RehearsalImportDrafts | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const resetAndClose = () => {
    setOpen(false);
    setFile(null);
    setPreviewUrl("");
    setDrafts(null);
    setRowErrors({});
    setError("");
  };

  const close = () => {
    if (!analyzing && !saving) resetAndClose();
  };

  const chooseFile = (nextFile?: File) => {
    setDrafts(null);
    setRowErrors({});
    setError("");
    if (!nextFile) {
      setFile(null);
      setPreviewUrl("");
      return;
    }
    if (!REHEARSAL_IMPORT_IMAGE_TYPES.includes(nextFile.type as never)) {
      setFile(null);
      setPreviewUrl("");
      setError("PNG、JPEG、WEBPの画像を選択してください");
      return;
    }
    if (nextFile.size > REHEARSAL_IMPORT_MAX_IMAGE_BYTES) {
      setFile(null);
      setPreviewUrl("");
      setError("画像は4MB以下にしてください");
      return;
    }
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
  };

  const updateDraft = (sourceRow: number, update: (draft: RehearsalImportDraft) => RehearsalImportDraft) => {
    setDrafts((current) => current ? {
      ...current,
      candidates: current.candidates.map((draft) => draft.sourceRow === sourceRow ? update(draft) : draft),
    } : current);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[sourceRow];
      return next;
    });
  };

  const analyze = async () => {
    if (!file || analyzing) return;
    setAnalyzing(true);
    setError("");
    setDrafts(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("ログイン状態を確認できません。再ログインしてください");
      const token = await user.getIdToken();
      const formData = new FormData();
      formData.set("image", file);
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/rehearsals/import`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: formData,
      });
      const body = await response.json() as RehearsalImportResponse | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "画像を解析できませんでした");
      setDrafts(createRehearsalImportDrafts(body as RehearsalImportResponse));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "画像を解析できませんでした");
    } finally {
      setAnalyzing(false);
    }
  };

  const save = async () => {
    if (!drafts || saving) return;
    const validation = validateRehearsalImportDrafts(drafts.candidates);
    if (validation.inputs.length === 0) {
      setError("インポートする稽古予定を1件以上選択してください");
      return;
    }
    if (validation.errors.length > 0) {
      setRowErrors(Object.fromEntries(validation.errors.map(({ sourceRow, message }) => [sourceRow, message])));
      setError("入力に問題がある行を修正してください");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const count = validation.inputs.length;
      await createProjectRehearsalBatch(projectId, validation.inputs, actor, `スクリーンショットから稽古予定を${count}件追加`);
      await onImported(count);
      resetAndClose();
    } catch {
      setError("稽古予定を保存できませんでした。入力内容を保持したまま、もう一度お試しいただけます");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button className={styles.secondaryButton} type="button" onClick={() => setOpen(true)}>スクリーンショットからインポート</button>
      {open && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
        <section className={`${styles.dialog} ${styles.importDialog}`} role="dialog" aria-modal="true" aria-labelledby="import-title">
          <header><div><p>IMPORT</p><h2 id="import-title">予約画面から稽古を追加</h2></div><button aria-label="閉じる" type="button" onClick={close}>×</button></header>
          <div className={styles.importBody}>
            {!drafts && <>
              <p className={styles.importLead}>茅ヶ崎市公共施設予約システムの「予約申込一覧」を解析します。結果を確認・修正するまで保存されません。</p>
              <input ref={inputRef} className={styles.visuallyHidden} type="file" accept={REHEARSAL_IMPORT_IMAGE_TYPES.join(",")} onChange={(event) => { chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
              <button className={styles.fileButton} type="button" onClick={() => inputRef.current?.click()}>画像を選択</button>
              {file && <p className={styles.fileName}>{file.name}（{Math.ceil(file.size / 1024)}KB）</p>}
              {previewUrl && <Image unoptimized width={720} height={320} className={styles.importPreview} src={previewUrl} alt="解析する予約申込一覧のプレビュー" />}
            </>}

            {drafts && <section className={styles.importResults} aria-labelledby="result-title">
              <div className={styles.sectionTitle}><h3 id="result-title">読み取り結果の確認</h3><span>{drafts.candidates.length}候補</span></div>
              <p className={styles.importLead}>チェックした行だけを保存します。種別は場所から仮設定されています。</p>
              {drafts.warnings.length > 0 && <ul className={styles.importWarnings}>{drafts.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
              <div className={styles.importRows}>{drafts.candidates.map((draft) => {
                const inputError = getRehearsalInputError(draft.input);
                const unknownNeedsCorrection = draft.status === "unknown" && inputError !== null;
                const duplicate = hasExistingRehearsalDuplicate(draft.input, existingRehearsals);
                return <article className={`${styles.importRow} ${draft.warnings.length > 0 || draft.status === "unknown" ? styles.needsReview : ""}`} key={draft.sourceRow}>
                  <header><label className={styles.importCheck}><input type="checkbox" checked={draft.selected} disabled={unknownNeedsCorrection} onChange={(event) => updateDraft(draft.sourceRow, (current) => ({ ...current, selected: event.target.checked }))} /><strong>行 {draft.sourceRow}をインポート</strong></label>{draft.status === "unknown" && <span className={styles.unknown}>要確認</span>}</header>
                  {draft.warnings.length > 0 && <ul className={styles.importWarnings}>{draft.warnings.map((warning) => <li key={warning}>{warningLabels[warning]}</li>)}</ul>}
                  {unknownNeedsCorrection && <p className={styles.reviewNote}>必要な日時等を修正すると選択できます。</p>}
                  {duplicate && <p className={styles.duplicateWarning}>同じ日時・場所の稽古予定がすでにあります</p>}
                  <ImportFields draft={draft} onChange={(input) => updateDraft(draft.sourceRow, (current) => ({ ...current, input }))} />
                  {rowErrors[draft.sourceRow] && <p className={styles.rowError} role="alert">行 {draft.sourceRow}: {rowErrors[draft.sourceRow]}</p>}
                  <details><summary>読み取り原文</summary><p>{draft.rawText || "—"}</p></details>
                </article>;
              })}</div>
              {drafts.cancelled.length > 0 && <details className={styles.cancelledSection}><summary>除外された予約（取消） <span>{drafts.cancelled.length}件</span></summary><div>{drafts.cancelled.map((row) => <CancelledRow key={row.sourceRow} row={row} />)}</div></details>}
            </section>}
            {error && <p className={styles.formError} role="alert">{error}</p>}
          </div>
          <footer className={styles.importFooter}>
            <button className={styles.secondaryButton} type="button" onClick={close}>閉じる</button>
            {!drafts
              ? <button type="button" disabled={!file || analyzing} onClick={() => void analyze()}>{analyzing ? "解析中…" : "解析する"}</button>
              : <><button className={styles.secondaryButton} type="button" disabled={saving} onClick={() => { setDrafts(null); setRowErrors({}); setError(""); }}>画像を選び直す</button><button type="button" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "選択した予定を保存"}</button></>}
          </footer>
        </section>
      </div>}
    </>
  );
}
