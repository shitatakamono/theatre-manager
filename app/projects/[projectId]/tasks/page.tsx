"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/app/AuthProvider";
import { addTask, getCategories, getProjectPerformanceData, getTasks, toggleTask, toCategoryMap, type ProjectPerformanceRecord, type Task } from "@/lib/firestore";
import { buildProductionTaskViews, canToggleProductionTask, type ProductionTaskView } from "@/lib/production-task-view";
import { buildTaskCreateInput, filterTasks, formatTaskDueDate, getTaskAssignee, getTaskDeadlineWarning, getTaskDueDate, getTaskProgressStatus, getTokyoDateString, TASK_STATUS_LABELS, TASK_WARNING_LABELS, type TaskCreateInput, type TaskListFilter } from "@/lib/task-view";
import { TaskDetailDrawer } from "../TaskDetailDrawer";
import { useProjectAccess } from "../ProjectAccess";
import styles from "./tasks.module.css";

type TasksPageProps = { params: Promise<{ projectId: string }> };
const filters: { value: TaskListFilter; label: string }[] = [
  { value: "all", label: "すべて" }, { value: "mine", label: "自分" },
  { value: "incomplete", label: "未完了" }, { value: "due-soon", label: "期限が近い" },
];
const emptyTaskInput: TaskCreateInput = { title: "", stage: "", category_parent: "", category_child: "" };

export default function TasksPage({ params }: TasksPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { profile } = useAuth();
  const { canEdit } = useProjectAccess();
  const [project, setProject] = useState<ProjectPerformanceRecord | null>(null);
  const [customTasks, setCustomTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<TaskListFilter>("all");
  const [selectedTask, setSelectedTask] = useState<ProductionTaskView | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [taskInput, setTaskInput] = useState<TaskCreateInput>(emptyTaskInput);
  const [categoryMap, setCategoryMap] = useState<Record<string, string[]>>({});
  const today = getTokyoDateString();

  useEffect(() => {
    let active = true;
    void Promise.all([getProjectPerformanceData(projectId), getTasks(projectId), getCategories()]).then(([projectRecord, items, categories]) => {
      if (active) { setProject(projectRecord); setCustomTasks(items); setCategoryMap(toCategoryMap(categories)); }
    })
      .catch(() => { if (active) setError("タスクを取得できませんでした。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  const tasks = useMemo(() => project ? buildProductionTaskViews(project, customTasks) : [], [customTasks, project]);
  const filtered = useMemo(() => filterTasks(tasks, filter, profile, today), [filter, profile, tasks, today]);

  async function handleToggleComplete(task: ProductionTaskView) {
    if (!canToggleProductionTask(task, canEdit) || !task.customTaskId) return;
    setSaving(true);
    try {
      const done = task.status !== "complete";
      await toggleTask(projectId, task.customTaskId, done);
      setCustomTasks((current) => current.map((item) => item.id === task.customTaskId ? { ...item, done } : item));
      const next = { ...task, status: done ? "complete" as const : "not-started" as const };
      setSelectedTask(next);
    } finally { setSaving(false); }
  }

  function handleOpenTask(task: ProductionTaskView) {
    if (task.source === "customTask") setSelectedTask(task);
    else router.push(task.editTarget);
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    const values = buildTaskCreateInput(taskInput);
    if (!values) { setError("タスク名を入力してください。"); return; }
    setCreating(true); setError("");
    try {
      const id = await addTask(projectId, values);
      setCustomTasks((current) => [...current, { id, ...values, done: false }]);
      setTaskInput(emptyTaskInput); setShowCreate(false);
    } catch { setError("タスクを追加できませんでした。"); }
    finally { setCreating(false); }
  }

  return <main className={styles.page}>
    <header className={styles.heading}>
      <div><p>PRODUCTION TASKS</p><h1>タスク一覧</h1><span>制作作業を期限順に確認し、処理するための一覧です。</span></div>
      <div className={styles.headingActions}>{canEdit && <button type="button" onClick={() => setShowCreate((current) => !current)}>＋ タスクを追加</button>}<Link href={`/projects/${projectId}#production-roadmap`}>ロードマップを見る</Link></div>
    </header>
    {showCreate && canEdit && <form className={styles.createPanel} onSubmit={handleCreateTask}>
      <label className={styles.taskTitle}><span>タスク名</span><input autoFocus required value={taskInput.title} onChange={(event) => setTaskInput((current) => ({ ...current, title: event.target.value }))} /></label>
      <label><span>時期</span><select value={taskInput.stage} onChange={(event) => setTaskInput((current) => ({ ...current, stage: event.target.value }))}><option value="">未設定</option><option value="前期">前期</option><option value="中期">中期</option><option value="後期">後期</option><option value="当日">当日</option></select></label>
      <label><span>カテゴリ</span><select value={taskInput.category_parent} onChange={(event) => setTaskInput((current) => ({ ...current, category_parent: event.target.value, category_child: "" }))}><option value="">未設定</option>{Object.keys(categoryMap).map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label><span>詳細カテゴリ</span><select disabled={!taskInput.category_parent} value={taskInput.category_child} onChange={(event) => setTaskInput((current) => ({ ...current, category_child: event.target.value }))}><option value="">未設定</option>{(categoryMap[taskInput.category_parent] ?? []).map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <div className={styles.createActions}><button type="button" onClick={() => { setShowCreate(false); setTaskInput(emptyTaskInput); }}>キャンセル</button><button type="submit" disabled={creating}>{creating ? "追加中…" : "追加する"}</button></div>
    </form>}
    <nav className={styles.filters} aria-label="タスク絞り込み">{filters.map((item) => <button aria-pressed={filter === item.value} key={item.value} onClick={() => setFilter(item.value)} type="button">{item.label}</button>)}</nav>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.empty}>読み込み中…</p> : filtered.length === 0 ? <p className={styles.empty}>条件に一致するタスクはありません。</p> : <>
      <div className={styles.tableWrap}><table><thead><tr><th>期限</th><th>タスク名</th><th>担当</th><th>状態</th></tr></thead><tbody>{filtered.map((task) => {
        const warning = getTaskDeadlineWarning(task, today); const status = getTaskProgressStatus(task);
        return <tr key={task.id} data-warning={warning} tabIndex={0} onClick={() => handleOpenTask(task)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") handleOpenTask(task); }}>
          <td><time>{formatTaskDueDate(getTaskDueDate(task))}</time>{warning !== "none" && <small>{TASK_WARNING_LABELS[warning]}</small>}</td>
          <td><strong>{task.title || "名称未設定のタスク"}</strong><span>{[task.sectionLabel, task.detailLabel].filter(Boolean).join(" / ")}{task.custom && <em className={styles.customBadge}>カスタム</em>}</span></td>
          <td>{getTaskAssignee(task)}</td><td><span className={styles.status} data-status={status}>{TASK_STATUS_LABELS[status]}</span></td>
        </tr>;
      })}</tbody></table></div>
      <div className={styles.cards}>{filtered.map((task) => {
        const warning = getTaskDeadlineWarning(task, today); const status = getTaskProgressStatus(task);
        return <button type="button" key={task.id} data-warning={warning} onClick={() => handleOpenTask(task)}><span className={styles.cardTop}><time>{formatTaskDueDate(getTaskDueDate(task))}</time>{warning !== "none" && <em>{TASK_WARNING_LABELS[warning]}</em>}</span><strong>{task.title || "名称未設定のタスク"}</strong><span>{task.sectionLabel}{task.custom ? "・カスタム" : ""}</span><span>担当：{getTaskAssignee(task)}</span><span className={styles.status} data-status={status}>{TASK_STATUS_LABELS[status]}</span></button>;
      })}</div>
    </>}
    <TaskDetailDrawer task={selectedTask} canEdit={canEdit} saving={saving} onClose={() => setSelectedTask(null)} onToggleComplete={handleToggleComplete} />
  </main>;
}
