import type { CSSProperties } from "react";
import Link from "next/link";
import { getProjectPerformanceData } from "@/lib/firestore";
import styles from "./project-roadmap.module.css";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

type ProductionStatus = "not-started" | "in-progress" | "complete";

type RoadmapRange = {
  kind: "range";
  slug: string;
  label: string;
  start: TimelineOffset;
  end: TimelineOffset;
  status: ProductionStatus;
};

type RoadmapMilestone = {
  kind: "milestone";
  slug: string;
  label: string;
  offset: TimelineOffset;
  status: ProductionStatus;
};

type RoadmapSection = RoadmapRange | RoadmapMilestone;

type TimelineOffset = { months?: number; weeks?: number };

const timelinePoints: { label?: string; offset: TimelineOffset }[] = [
  { label: "6か月前", offset: { months: -6 } },
  { label: "5か月前", offset: { months: -5 } },
  { label: "4か月前", offset: { months: -4 } },
  { label: "3か月前", offset: { months: -3 } },
  { offset: { weeks: -10 } },
  { label: "2か月前", offset: { months: -2 } },
  { offset: { weeks: -6 } },
  { label: "1か月前", offset: { months: -1 } },
  { offset: { weeks: -3 } },
  { offset: { weeks: -2 } },
  { offset: { weeks: -1 } },
  { label: "本番", offset: {} },
  { label: "公演後", offset: { weeks: 2 } },
];

const roadmapSections: RoadmapSection[] = [
  { kind: "range", slug: "venue", label: "会場", start: { months: -6 }, end: {}, status: "not-started" },
  { kind: "range", slug: "flyer", label: "チラシ・ポスター", start: { months: -4 }, end: { months: -2 }, status: "not-started" },
  { kind: "range", slug: "web", label: "Web・SNS", start: { months: -4 }, end: { weeks: 2 }, status: "not-started" },
  { kind: "range", slug: "tickets", label: "チケット", start: { months: -2 }, end: {}, status: "not-started" },
  { kind: "range", slug: "reception", label: "当日受付", start: { months: -1 }, end: {}, status: "not-started" },
  { kind: "range", slug: "accounting", label: "会計", start: { months: -6 }, end: { weeks: 2 }, status: "not-started" },
];

const statusLabels: Record<ProductionStatus, string> = {
  "not-started": "未着手",
  "in-progress": "進行中",
  complete: "完了",
};

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

function parseDate(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target;
}

function addWeeks(date: Date, weeks: number): Date {
  return new Date(date.getTime() + weeks * 7 * DAY_IN_MILLISECONDS);
}

function getOffsetDate(date: Date, offset: TimelineOffset): Date {
  if (offset.months !== undefined) return addMonths(date, offset.months);
  return addWeeks(date, offset.weeks ?? 0);
}

function getTodayInJapan(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day))
  );
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function formatTimelineDate(date: Date): string {
  return `${date.getUTCMonth() + 1}月${date.getUTCDate()}日`;
}

function formatPeriod(firstDate: Date | null, lastDate: Date | null): string {
  if (!firstDate) return "公演日未設定";
  if (!lastDate || firstDate.getTime() === lastDate.getTime()) {
    return formatDate(firstDate);
  }
  return `${formatDate(firstDate)} 〜 ${formatDate(lastDate)}`;
}

function getCountdown(firstDate: Date | null, today: Date): string {
  if (!firstDate) return "本番日未設定";

  const days = Math.round(
    (firstDate.getTime() - today.getTime()) / DAY_IN_MILLISECONDS
  );
  if (days > 0) return `本番まであと${days}日`;
  if (days === 0) return "本番当日";
  return "本番終了";
}

function getTimelinePosition(firstDate: Date | null, date: Date): number | null {
  if (!firstDate) return null;

  const timelineStart = addMonths(firstDate, -6);
  const timelineEnd = addWeeks(firstDate, 2);
  const elapsed = date.getTime() - timelineStart.getTime();
  const duration = timelineEnd.getTime() - timelineStart.getTime();

  return Math.min(100, Math.max(0, (elapsed / duration) * 100));
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = await params;
  const project = await getProjectPerformanceData(projectId);

  if (!project) {
    return (
      <main className={styles.notFound}>
        <h1>公演が見つかりません。</h1>
        <Link href="/">公演一覧に戻る</Link>
      </main>
    );
  }

  const basic = project.data.performanceInfo;
  const venue = project.data.venue;
  const performanceDates = (project.data.performances ?? [])
    .map((performance) => parseDate(performance.date))
    .filter((date): date is Date => date !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  const firstDate =
    performanceDates[0] ??
    parseDate(project.showStartDate) ??
    parseDate(project.startDate);
  const lastDate =
    performanceDates.at(-1) ??
    parseDate(project.showEndDate) ??
    parseDate(project.endDate) ??
    firstDate;
  const today = getTodayInJapan();
  const todayPosition = getTimelinePosition(firstDate, today);
  const marks = timelinePoints.map((point, index) => {
    const date = firstDate ? getOffsetDate(firstDate, point.offset) : null;
    return {
      ...point,
      date,
      position: date
        ? getTimelinePosition(firstDate, date) ?? 0
        : index / (timelinePoints.length - 1) * 100,
    };
  });
  const timelineStyle =
    todayPosition === null
      ? undefined
      : ({ "--today-position": `${todayPosition}%` } as CSSProperties);
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";
  const performanceName = basic?.performanceName || "公演名称未設定";
  const venueName = venue?.name || "会場未設定";
  const hallName = venue?.hall;
  const notices = [
    !firstDate ? "公演日が未設定です" : null,
    !venue?.name ? "会場が未設定です" : null,
    !basic?.durationMinutes ? "上演時間が未設定です" : null,
  ].filter((notice): notice is string => notice !== null);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.topLine}>
          <Link className={styles.backLink} href="/">
            ← 公演一覧
          </Link>
          <nav className={styles.actions} aria-label="公演メニュー">
            <Link href={`/projects/${projectId}/tasks`}>タスク一覧</Link>
            <Link className={styles.infoLink} href={`/projects/${projectId}/info`}>
              公演情報を見る
            </Link>
          </nav>
        </div>

        <div className={styles.hero}>
          <div className={styles.titleBlock}>
            <p className={styles.performanceName}>{performanceName}</p>
            <h1>{title}</h1>
            <dl className={styles.summary}>
              <div>
                <dt>公演期間</dt>
                <dd>{formatPeriod(firstDate, lastDate)}</dd>
              </div>
              <div>
                <dt>会場</dt>
                <dd>
                  {venueName}
                  {hallName ? ` / ${hallName}` : ""}
                </dd>
              </div>
            </dl>
          </div>
          <div className={styles.countdown}>{getCountdown(firstDate, today)}</div>
        </div>
      </header>

      <section className={styles.roadmapSection} aria-labelledby="roadmap-title">
        <div className={styles.sectionHeading}>
          <div>
            <p>PRODUCTION ROADMAP</p>
            <h2 id="roadmap-title">制作ロードマップ</h2>
          </div>
          <span>各項目を選択すると詳細画面へ移動します</span>
        </div>

        <div className={styles.chartViewport}>
          <div className={styles.chart} style={timelineStyle}>
            <div className={styles.timelineHeader}>
              <div className={styles.sectionHeader}>制作セクション</div>
              <div className={styles.months}>
                {marks.map((mark) => (
                  <span
                    className={`${styles.timelineMark} ${mark.position === 100 ? styles.timelineMarkEnd : ""}`}
                    key={`${mark.offset.months ?? "w"}-${mark.offset.weeks ?? 0}`}
                    style={{ "--mark-position": `${mark.position}%` } as CSSProperties}
                  >
                    {mark.label && <strong>{mark.label}</strong>}
                    <small>{mark.date ? formatTimelineDate(mark.date) : "--月--日"}</small>
                  </span>
                ))}
                {todayPosition !== null && (
                  <span className={styles.todayMarker} aria-label="今日">
                    今日
                  </span>
                )}
              </div>
            </div>

            <div className={styles.rows}>
              {roadmapSections.map((section) => (
                <Link
                  className={styles.roadmapRow}
                  href={`/projects/${projectId}/production/${section.slug}`}
                  key={section.slug}
                >
                  <div className={styles.sectionLabel}>
                    <strong>{section.label}</strong>
                    <span data-status={section.status}>
                      {statusLabels[section.status]}
                    </span>
                  </div>
                  <div className={styles.timeline}>
                    <span
                      className={section.kind === "range" ? styles.bar : styles.milestone}
                      style={firstDate ? (section.kind === "range" ? ({
                        "--bar-start": `${getTimelinePosition(firstDate, getOffsetDate(firstDate, section.start)) ?? 0}%`,
                        "--bar-end": `${getTimelinePosition(firstDate, getOffsetDate(firstDate, section.end)) ?? 100}%`,
                      } as CSSProperties) : ({
                        "--milestone-position": `${getTimelinePosition(firstDate, getOffsetDate(firstDate, section.offset)) ?? 0}%`,
                      } as CSSProperties)) : undefined}
                    />
                    {marks.map((mark) => (
                      <span
                        className={styles.gridLine}
                        key={`${mark.offset.months ?? "w"}-${mark.offset.weeks ?? 0}`}
                        style={{ "--mark-position": `${mark.position}%` } as CSSProperties}
                      />
                    ))}
                    {todayPosition !== null && <span className={styles.todayLine} />}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={styles.notices} aria-labelledby="notices-title">
        <div className={styles.noticeHeading}>
          <h2 id="notices-title">要確認</h2>
          <span>{notices.length}件</span>
        </div>
        {notices.length > 0 ? (
          <ul>
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        ) : (
          <p>現在、要確認事項はありません。</p>
        )}
      </section>
    </main>
  );
}
