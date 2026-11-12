"use client";

import { useRef, useState } from "react";
import { analyzeExternalPerformanceCsv, type ExternalPerformanceCsvAnalysis } from "@/lib/external-performance-csv";
import type { ExternalPerformance } from "@/lib/external-performances";
import { auth } from "@/lib/firebase";
import type { ExternalPerformanceImportResult } from "@/lib/server/external-performance-import";
import styles from "./external-performances.module.css";

const MAX_CSV_BYTES = 1024 * 1024;

function dateLabel(startDate: string, endDate: string): string {
  if (!startDate && !endDate) return "日程未定";
  if (!endDate || startDate === endDate) return startDate || endDate;
  return `${startDate || "未定"} 〜 ${endDate}`;
}

export function ExternalPerformanceCsvImport({ projectId, existing, onImported }: {
  projectId: string;
  existing: ExternalPerformance[];
  onImported: () => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState<ExternalPerformanceCsvAnalysis | null>(null);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<ExternalPerformanceImportResult | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setFileName(""); setAnalysis(null); setConfirmed(new Set()); setResult(null); setError("");
    if (inputRef.current) inputRef.current.value = "";
  };
  const close = () => { if (!saving) { setOpen(false); reset(); } };

  const choose = async (file?: File) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_CSV_BYTES) { setError("CSVは1MB以下にしてください"); return; }
    try {
      const text = await file.text();
      if (text.includes("\uFFFD")) throw new Error("CSVをUTF-8で保存してから選択してください");
      setAnalysis(analyzeExternalPerformanceCsv(text, existing));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSVを読み込めませんでした");
    }
  };

  const toggleConfirmation = (sourceRow: number, checked: boolean) => {
    setConfirmed((current) => {
      const next = new Set(current);
      if (checked) next.add(sourceRow); else next.delete(sourceRow);
      return next;
    });
  };

  const save = async () => {
    if (!analysis || saving) return;
    const rows = analysis.rows.filter((row) => row.input && (
      row.status === "ready" || (row.status === "possible_duplicate" && confirmed.has(row.sourceRow))
    )).map((row) => ({
      sourceRow: row.sourceRow,
      input: row.input!,
      confirmPossibleDuplicate: row.status === "possible_duplicate",
    }));
    if (rows.length === 0) { setError("登録する公演がありません"); return; }
    setSaving(true); setError(""); setResult(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("ログイン状態を確認できません。再ログインしてください");
      const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/external-performances/import`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      });
      const body = await response.json() as ExternalPerformanceImportResult | { error?: string };
      if (!response.ok) throw new Error("error" in body && body.error ? body.error : "CSVを取り込めませんでした");
      const nextResult = body as ExternalPerformanceImportResult;
      setResult(nextResult);
      if (nextResult.imported > 0) await onImported();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "CSVを取り込めませんでした");
    } finally { setSaving(false); }
  };

  return <>
    <button className={styles.secondaryAction} type="button" onClick={() => setOpen(true)}>CSV取込</button>
    {open && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) close(); }}>
      <section className={`${styles.editor} ${styles.csvDialog}`} role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
        <header><div><p>CSV IMPORT</p><h2 id="csv-import-title">公演候補をCSVから登録</h2></div><button type="button" aria-label="閉じる" onClick={close}>×</button></header>
        <div className={styles.csvBody}>
          <p className={styles.csvLead}>団体名・公演名・会場・開始日・終了日・備考・日程原文のCSVを読み込みます。確認して登録するまで保存されません。</p>
          <input ref={inputRef} className={styles.visuallyHidden} type="file" accept=".csv,text/csv" onChange={(event) => { void choose(event.target.files?.[0]); }} />
          <button className={styles.fileButton} type="button" disabled={saving} onClick={() => inputRef.current?.click()}>CSVを選択</button>
          {fileName && <p className={styles.fileName}>{fileName}</p>}
          {analysis && <>
            <div className={styles.csvSummary} aria-label="CSV解析結果">
              <span>読込 <strong>{analysis.total}</strong>件</span><span>登録可能 <strong>{analysis.ready}</strong>件</span><span>重複スキップ <strong>{analysis.duplicates}</strong>件</span><span>要確認 <strong>{analysis.possibleDuplicates}</strong>件</span><span>エラー <strong>{analysis.errors}</strong>件</span>
            </div>
            <div className={styles.csvRows}>{analysis.rows.map((row) => <article key={row.sourceRow} data-status={row.status}>
              <header><div><small>CSV {row.sourceRow}行目</small><strong>{row.organizationName || "団体名未入力"}／{row.performanceName || "公演名未入力"}</strong></div><span>{row.status === "ready" ? "登録可能" : row.status === "duplicate" ? "重複" : row.status === "possible_duplicate" ? "要確認" : "エラー"}</span></header>
              <dl><div><dt>会場</dt><dd>{row.venue || "未定"}</dd></div><div><dt>日程</dt><dd>{dateLabel(row.startDate, row.endDate)}</dd></div><div><dt>保存する備考</dt><dd>{row.note || "なし"}</dd></div></dl>
              <p>{row.message}</p>
              {row.status === "possible_duplicate" && <label className={styles.confirmDuplicate}><input type="checkbox" checked={confirmed.has(row.sourceRow)} onChange={(event) => toggleConfirmation(row.sourceRow, event.target.checked)} />既存候補を確認したうえで、この公演も登録する</label>}
            </article>)}</div>
          </>}
          {result && <div className={styles.importResult} role="status"><strong>取込結果</strong><span>成功 {result.imported}件／スキップ {result.skipped}件／失敗 {result.failed}件</span>{result.rows.some(({ status }) => status !== "imported") && <ul>{result.rows.filter(({ status }) => status !== "imported").map((row) => <li key={row.sourceRow}>{row.sourceRow}行目：{row.message}</li>)}</ul>}</div>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
        <footer className={styles.csvFooter}><button type="button" disabled={saving} onClick={close}>閉じる</button><button className={styles.saveButton} type="button" disabled={!analysis || saving || Boolean(result)} onClick={() => void save()}>{saving ? "登録中…" : "確認した公演を登録"}</button></footer>
      </section>
    </div>}
  </>;
}
