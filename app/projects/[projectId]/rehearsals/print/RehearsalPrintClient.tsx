"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { buildRehearsalPrintModel } from "@/lib/rehearsal-print";
import { getAllProjectRehearsals, type Rehearsal } from "@/lib/rehearsals";
import { RehearsalTimeline } from "../RehearsalTimeline";
import styles from "./rehearsal-print.module.css";

export function RehearsalPrintClient({ projectId }: { projectId: string }) {
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getAllProjectRehearsals(projectId)
      .then((items) => { if (active) setRehearsals(items); })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "稽古予定を読み込めませんでした");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const model = useMemo(() => buildRehearsalPrintModel(rehearsals), [rehearsals]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p>REHEARSAL SCHEDULE</p>
          <h1>稽古スケジュール</h1>
          <span>{model.days.length}日・{model.rehearsalCount}件</span>
        </div>
        <nav className={styles.screenActions} aria-label="印刷操作">
          <Link href={`/projects/${projectId}/rehearsals`}>稽古スケジュールへ戻る</Link>
          <button type="button" onClick={() => window.print()}>印刷する</button>
        </nav>
      </header>

      {loading ? <p className={styles.message}>読み込み中…</p> : error ? <p className={styles.error} role="alert">{error}</p> : model.rehearsalCount === 0 ? <p className={styles.message}>今日以降の稽古予定はありません。</p> : (
        <RehearsalTimeline model={model} />
      )}
    </main>
  );
}
