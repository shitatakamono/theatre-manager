"use client";

import { use, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getProjectActivityLogs, getProjectPerformanceData, getTasks, toggleTask, type ProjectPerformanceRecord, type Task } from "@/lib/firestore";
import { getProjectAttendanceRecords, type AttendanceRecord } from "@/lib/attendance";
import type { Participant } from "@/lib/participants";
import { getProjectAttendanceParticipants } from "@/lib/people";
import { buildDashboardAttendanceSummary } from "@/lib/project-dashboard";
import { hasEnteredPerformanceInformation } from "@/lib/project-navigation";
import { getProjectRehearsals, timestampToTokyoInput, type Rehearsal } from "@/lib/rehearsals";
import type { ActivityLog } from "@/lib/activity";
import { useAuth } from "@/app/AuthProvider";
import styles from "./project-roadmap.module.css";
import { useProjectAccess } from "./ProjectAccess";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { buildProductionTaskViews, canToggleProductionTask, type ProductionTaskView } from "@/lib/production-task-view";
import { aggregateTaskWarning, getTaskAssignee, getTaskDeadlineWarning, getTaskDueDate, getTaskProgressStatus, getTaskSection, getTokyoDateString, sortTasksByDeadline, TASK_STATUS_LABELS, TASK_WARNING_LABELS, type ProductionSectionSlug } from "@/lib/task-view";

type ProjectPageProps = {
  params: Promise<{ projectId: string }>;
};

type DashboardData = {
  upcomingRehearsals: Rehearsal[];
  participants: Participant[];
  attendance: AttendanceRecord[];
  activity: ActivityLog[];
  tasks: Task[];
};

type RoadmapRange = {
  kind: "range";
  slug: ProductionSectionSlug;
  label: string;
  start: TimelineOffset;
  end: TimelineOffset;
};

type RoadmapMilestone = {
  kind: "milestone";
  slug: ProductionSectionSlug;
  label: string;
  offset: TimelineOffset;
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
  { kind: "range", slug: "venue", label: "会場", start: { months: -6 }, end: {} },
  { kind: "range", slug: "flyer", label: "チラシ・ポスター", start: { months: -4 }, end: { months: -2 } },
  { kind: "range", slug: "web", label: "Web・SNS", start: { months: -4 }, end: { weeks: 2 } },
  { kind: "range", slug: "tickets", label: "チケット", start: { months: -2 }, end: {} },
  { kind: "range", slug: "reception", label: "当日受付", start: { months: -1 }, end: {} },
  { kind: "range", slug: "accounting", label: "会計", start: { months: -6 }, end: { weeks: 2 } },
];

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

function formatDashboardDate(value: unknown): string {
  if (!value || typeof value !== "object" || !("toDate" in value) || typeof value.toDate !== "function") return "更新日時未確定";
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(value.toDate() as Date);
}

function formatNextRehearsal(rehearsal: Rehearsal | undefined): { title: string; detail: string } {
  if (!rehearsal) return { title: "予定なし", detail: "今後の稽古は未登録です" };
  const start = timestampToTokyoInput(rehearsal.startAt);
  const end = rehearsal.endAt ? timestampToTokyoInput(rehearsal.endAt).time : "終了未設定";
  const date = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", weekday: "short" }).format(rehearsal.startAt.toDate());
  return { title: `${date} ${start.time}〜${end}`, detail: rehearsal.venue || "会場未設定" };
}

export default function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { profile } = useAuth();
  const { canEdit, role, actor } = useProjectAccess();
  const [project, setProject] = useState<ProjectPerformanceRecord | null>();
  const [dashboard, setDashboard] = useState<DashboardData>();
  const [expandedSections, setExpandedSections] = useState<ProductionSectionSlug[]>([]);
  const [selectedTask, setSelectedTask] = useState<ProductionTaskView | null>(null);
  const [savingTask, setSavingTask] = useState(false);

  useEffect(() => {
    void getProjectPerformanceData(projectId).then(setProject);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getProjectRehearsals(projectId),
      getProjectAttendanceParticipants(projectId),
      getProjectAttendanceRecords(projectId),
      getProjectActivityLogs(projectId),
      getTasks(projectId),
    ]).then(([rehearsals, participants, attendance, activity, tasks]) => {
      if (active) setDashboard({ upcomingRehearsals: rehearsals.upcoming, participants, attendance, activity, tasks });
    }).catch(() => {
      if (active) setDashboard({ upcomingRehearsals: [], participants: [], attendance: [], activity: [], tasks: [] });
    });
    return () => { active = false; };
  }, [projectId]);

  if (project === undefined) return <main className={styles.notFound}>読み込み中…</main>;

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
  const enteredTitle = basic?.title || project.legacyTitle;
  const title = enteredTitle || "公演タイトル未設定";
  const performanceName = basic?.performanceName || "公演名称未設定";
  const venueName = venue?.name || "会場未設定";
  const hallName = venue?.hall;
  const notices = [
    !firstDate ? "公演日が未設定です" : null,
    !venue?.name ? "会場が未設定です" : null,
    !basic?.durationMinutes ? "上演時間が未設定です" : null,
  ].filter((notice): notice is string => notice !== null);
  const hasPerformanceInformation = hasEnteredPerformanceInformation({
    organizer: basic?.organizer,
    performanceName: basic?.performanceName,
    title: enteredTitle,
    venueName: venue?.name,
    hasPerformanceDate: firstDate !== null,
  });
  const upcomingDates = [...new Set((dashboard?.upcomingRehearsals ?? []).map((rehearsal) => timestampToTokyoInput(rehearsal.startAt).date))];
  const attendanceSummary = buildDashboardAttendanceSummary(projectId, role, profile?.uid ?? "", dashboard?.participants ?? [], upcomingDates, dashboard?.attendance ?? []);
  const nextRehearsal = formatNextRehearsal(dashboard?.upcomingRehearsals[0]);
  const latestActivity = dashboard?.activity[0];
  const taskToday = getTokyoDateString();
  const productionTasks = buildProductionTaskViews(project, dashboard?.tasks ?? []);
  const sectionTasks = Object.fromEntries(roadmapSections.map((section) => [
    section.slug,
    sortTasksByDeadline(productionTasks.filter((task) => getTaskSection(task) === section.slug)),
  ])) as Record<ProductionSectionSlug, ProductionTaskView[]>;
  const warningCounts = productionTasks.reduce((counts, task) => {
    const warning = getTaskDeadlineWarning(task, taskToday);
    if (warning !== "none") counts[warning] += 1;
    return counts;
  }, { within14Days: 0, within7Days: 0, overdue: 0 });

  async function handleTaskToggle(task: ProductionTaskView) {
    if (!canToggleProductionTask(task, canEdit) || !task.customTaskId) return;
    setSavingTask(true);
    try {
      const done = task.status !== "complete";
      await toggleTask(projectId, task.customTaskId, done, actor.uid);
      const next = { ...task, status: done ? "complete" as const : "not-started" as const };
      setDashboard((current) => current ? { ...current, tasks: current.tasks.map((item) => item.id === task.customTaskId ? { ...item, done } : item) } : current);
      setSelectedTask(next);
    } finally { setSavingTask(false); }
  }

  function handleTaskOpen(task: ProductionTaskView) {
    if (task.source === "customTask") setSelectedTask(task);
    else router.push(task.editTarget);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
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
          <div className={styles.heroAside}><div className={styles.countdown}>{getCountdown(firstDate, today)}</div>{canEdit && <Link href={`/projects/${projectId}/info`}>{hasPerformanceInformation ? "公演情報を編集" : "公演情報を入力する"}</Link>}</div>
        </div>
      </header>

      {!hasPerformanceInformation && (
        <section className={styles.onboarding}>
          <div>
            <h2>公演情報が未入力です</h2>
            <p>劇団名・公演名・公演日・会場を入力すると、公演状況を正しく表示できます。</p>
          </div>
          {canEdit && <Link href={`/projects/${projectId}/info`}>公演情報を入力する</Link>}
        </section>
      )}

      <section className={styles.statusSummary} aria-label="公演状況サマリー">
        <Link href={`/projects/${projectId}/rehearsals`}><span>次回稽古</span><strong>{dashboard ? nextRehearsal.title : "読み込み中…"}</strong><small>{dashboard ? nextRehearsal.detail : ""}</small></Link>
        <Link href={attendanceSummary.href}><span>{attendanceSummary.label}</span><strong>{dashboard ? attendanceSummary.value : "読み込み中…"}</strong><small>{dashboard ? attendanceSummary.detail : ""}</small></Link>
        <Link href={`/projects/${projectId}/activity`}><span>最新の更新</span><strong>{latestActivity?.sectionLabel ?? (dashboard ? "更新なし" : "読み込み中…")}</strong><small>{latestActivity ? `${latestActivity.actorName}・${formatDashboardDate(latestActivity.createdAt)}` : "更新履歴を確認"}</small></Link>
      </section>

      <nav className={styles.shortcuts} aria-label="公演機能ショートカット">
        <Link href={`/projects/${projectId}/info`}><b>公演</b><span>基本情報を確認</span></Link>
        <Link href={`/projects/${projectId}/rehearsals`}><b>稽古</b><span>予定と出欠</span></Link>
        <Link href="#production-roadmap"><b>制作</b><span>準備の現在地</span></Link>
        <Link href={`/projects/${projectId}/activity`}><b>管理</b><span>更新を確認</span></Link>
      </nav>

      <section className={styles.roadmapSection} id="production-roadmap" aria-labelledby="roadmap-title">
        <div className={styles.sectionHeading}>
          <div>
            <p>PRODUCTION ROADMAP</p>
            <h2 id="roadmap-title">制作ロードマップ</h2>
          </div>
          <Link href={`/projects/${projectId}/tasks`}>タスク一覧を開く</Link>
        </div>

        {(warningCounts.overdue > 0 || warningCounts.within7Days > 0 || warningCounts.within14Days > 0) && <p className={styles.warningSummary}>
          {warningCounts.overdue > 0 && <span data-warning="overdue">期限超過 {warningCounts.overdue}件</span>}
          {warningCounts.within7Days > 0 && <span data-warning="within7Days">7日以内 {warningCounts.within7Days}件</span>}
          {warningCounts.within14Days > 0 && <span data-warning="within14Days">14日以内 {warningCounts.within14Days}件</span>}
        </p>}

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
              {roadmapSections.map((section) => {
                const tasks = sectionTasks[section.slug];
                const expanded = expandedSections.includes(section.slug);
                const sectionWarning = aggregateTaskWarning(tasks, taskToday);
                return <div className={styles.roadmapGroup} data-expanded={expanded} key={section.slug}>
                  <div className={styles.roadmapRow}>
                    <div className={styles.sectionLabel}>
                      <button type="button" aria-expanded={expanded} onClick={() => setExpandedSections((current) => current.includes(section.slug) ? current.filter((slug) => slug !== section.slug) : [...current, section.slug])}>
                        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span><strong>{section.label}</strong>
                      </button>
                      <div className={styles.sectionMeta}>
                        {tasks.length > 0 && <small>{tasks.length}件</small>}
                        {sectionWarning !== "none" && <em data-warning={sectionWarning}>{TASK_WARNING_LABELS[sectionWarning]}</em>}
                      </div>
                    </div>
                    <div className={styles.timeline}>
                      <span className={section.kind === "range" ? styles.bar : styles.milestone} style={firstDate ? (section.kind === "range" ? ({
                        "--bar-start": `${getTimelinePosition(firstDate, getOffsetDate(firstDate, section.start)) ?? 0}%`,
                        "--bar-end": `${getTimelinePosition(firstDate, getOffsetDate(firstDate, section.end)) ?? 100}%`,
                      } as CSSProperties) : ({ "--milestone-position": `${getTimelinePosition(firstDate, getOffsetDate(firstDate, section.offset)) ?? 0}%` } as CSSProperties)) : undefined} />
                      {marks.map((mark) => <span className={styles.gridLine} key={`${mark.offset.months ?? "w"}-${mark.offset.weeks ?? 0}`} style={{ "--mark-position": `${mark.position}%` } as CSSProperties} />)}
                      {todayPosition !== null && <span className={styles.todayLine} />}
                    </div>
                  </div>
                  {expanded && <div className={styles.taskRows}>{tasks.length === 0 ? <p>このセクションのタスクはありません。</p> : tasks.map((task) => {
                    const warning = getTaskDeadlineWarning(task, taskToday);
                    const dueDate = getTaskDueDate(task);
                    const status = getTaskProgressStatus(task);
                    const duePosition = firstDate && dueDate ? getTimelinePosition(firstDate, parseDate(dueDate) ?? firstDate) : null;
                    return <button type="button" className={styles.taskRow} key={task.id} onClick={() => handleTaskOpen(task)}>
                      <span className={styles.taskLabel}><strong>{task.title || "名称未設定のタスク"}</strong><small>{dueDate || "期限未設定"}・{getTaskAssignee(task)}・{TASK_STATUS_LABELS[status]}</small>{warning !== "none" && <em data-warning={warning}>{TASK_WARNING_LABELS[warning]}</em>}</span>
                      <span className={styles.taskTimeline}>{duePosition !== null && <i style={{ "--task-position": `${duePosition}%` } as CSSProperties} />}{marks.map((mark) => <span className={styles.gridLine} key={`${task.id}-${mark.position}`} style={{ "--mark-position": `${mark.position}%` } as CSSProperties} />)}{todayPosition !== null && <span className={styles.todayLine} />}</span>
                    </button>;
                  })}</div>}
                </div>;
              })}
            </div>
          </div>
        </div>
      </section>

      <TaskDetailDrawer task={selectedTask} canEdit={canEdit} saving={savingTask} onClose={() => setSelectedTask(null)} onToggleComplete={handleTaskToggle} />

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
