"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { getProjectActivityLogs } from "@/lib/firestore";
import type { ActivityLog } from "@/lib/activity";
import styles from "./activity.module.css";

type ActivityPageProps = {
  params: Promise<{ projectId: string }>;
};

function formatCreatedAt(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value)) return "日時未確定";
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return "日時未確定";
  const date = toDate.call(value) as Date;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export default function ActivityPage({ params }: ActivityPageProps) {
  const { projectId } = use(params);
  const [logs, setLogs] = useState<ActivityLog[]>();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getProjectActivityLogs(projectId)
      .then((items) => { if (active) setLogs(items); })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "更新履歴を読み込めませんでした");
        setLogs([]);
      });
    return () => { active = false; };
  }, [projectId]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href={`/projects/${projectId}`}>← 公演トップ</Link>
          <p>PROJECT ACTIVITY</p>
          <h1>更新履歴</h1>
        </div>
        <span>最新100件</span>
      </header>

      {logs === undefined ? <p className={styles.state}>読み込み中…</p> : null}
      {error ? <p className={`${styles.state} ${styles.error}`} role="alert">更新履歴を取得できませんでした。{error}</p> : null}
      {logs?.length === 0 && !error ? <p className={styles.state}>更新履歴はまだありません。</p> : null}

      {logs && logs.length > 0 ? (
        <ol className={styles.list}>
          {logs.map((log) => (
            <li className={styles.item} key={log.id}>
              <time>{formatCreatedAt(log.createdAt)}</time>
              <div className={styles.content}>
                <div className={styles.summary}>
                  <strong>{log.actorName}</strong>
                  <span>{log.sectionLabel}</span>
                </div>
                <p>{log.changedFields.join("、")}</p>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </main>
  );
}
