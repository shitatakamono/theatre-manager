import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  formatPublicRehearsalDate,
  formatPublicRehearsalTime,
  getPublicRehearsalTypeLabel,
} from "@/lib/rehearsal-share";
import { getPublicRehearsalSchedule } from "@/lib/server/rehearsal-share";
import styles from "./shared-rehearsals.module.css";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "稽古スケジュール",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function SharedRehearsalsPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const schedule = await getPublicRehearsalSchedule(token);
  if (!schedule) notFound();

  return <main className={styles.page}>
    <header className={styles.header}>
      <p>SEISAKUBOARD</p>
      <h1>{schedule.projectTitle}</h1>
      <span>稽古スケジュール</span>
    </header>
    <div className={styles.notice}>このページは閲覧専用です。予定は変更される場合があります。</div>
    {schedule.rehearsals.length === 0 ? <p className={styles.empty}>現在公開されている今後の稽古予定はありません。</p> : <ol className={styles.schedule}>
      {schedule.rehearsals.map((rehearsal, index) => <li className={styles.card} key={`${rehearsal.startAt}-${index}`}>
        <div className={styles.date}>{formatPublicRehearsalDate(rehearsal.startAt)}</div>
        <div className={styles.details}>
          <div className={styles.time}>{formatPublicRehearsalTime(rehearsal.startAt)}–{rehearsal.endAt ? formatPublicRehearsalTime(rehearsal.endAt) : "終了未設定"}</div>
          <span className={styles.type} data-type={rehearsal.type}>{getPublicRehearsalTypeLabel(rehearsal)}</span>
          <div className={styles.venue}>{rehearsal.venue || "会場未設定"}</div>
        </div>
      </li>)}
    </ol>}
    <footer className={styles.footer}>
      {schedule.updatedAt && <p>最終更新：{formatUpdatedAt(schedule.updatedAt)}</p>}
      <span>SeisakuBoard</span>
    </footer>
  </main>;
}
