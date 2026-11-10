"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/app/AuthProvider";
import type { ProjectMember } from "@/lib/auth";
import { addTask, deleteTask, getCategories, getProjectMembers, getProjectPerformanceData, getTasks, toggleTask, toCategoryMap, updateTask, type ProjectPerformanceRecord, type Task } from "@/lib/firestore";
import { buildProductionTaskViews, canToggleProductionTask, type ProductionTaskView } from "@/lib/production-task-view";
import { buildTaskCreateInput, filterTasks, formatTaskDueDate, getTaskAssignee, getTaskDeadlineWarning, getTaskDueDate, getTaskProgressStatus, getTokyoDateString, TASK_PRIORITY_LABELS, TASK_STATUS_LABELS, TASK_WARNING_LABELS, type TaskCreateInput, type TaskListFilter } from "@/lib/task-view";
import { TASK_RELATED_VIEW_DEFINITIONS, type TaskRelatedView } from "@/lib/task-related-views";
import { TaskDetailDrawer } from "../TaskDetailDrawer";
import { useProjectAccess } from "../ProjectAccess";
import styles from "./tasks.module.css";

type TasksPageProps = { params: Promise<{ projectId: string }> };
const filters: { value: TaskListFilter; label: string }[] = [
  { value: "all", label: "すべて" }, { value: "mine", label: "自分" },
  { value: "incomplete", label: "未完了" }, { value: "due-soon", label: "期限が近い" },
];
const emptyTaskInput: TaskCreateInput = {
  title: "", stage: "", category_parent: "", category_child: "", dueDate: "",
  status: "not-started", priority: "normal", assigneeUid: "", assigneeName: "", note: "",
  relatedView: "",
};

function taskToInput(task: Task): TaskCreateInput {
  const status = task.done ? "complete" : task.status === "in-progress" || task.status === "on-hold" ? task.status : "not-started";
  return {
    title: task.title ?? "", stage: task.stage ?? "", category_parent: task.category_parent ?? "",
    category_child: task.category_child ?? "", dueDate: task.dueDate ?? task.deadline ?? "", status,
    priority: task.priority === "low" || task.priority === "high" ? task.priority : "normal",
    assigneeUid: task.assigneeUid ?? "", assigneeName: task.assigneeName ?? task.assignee ?? task.responsible ?? "",
    note: task.note ?? "",
    relatedView: task.relatedView ?? "",
  };
}

export default function TasksPage({ params }: TasksPageProps) {
  const { projectId } = use(params);
  const router = useRouter();
  const { profile } = useAuth();
  const { canEdit, actor } = useProjectAccess();
  const [project, setProject] = useState<ProjectPerformanceRecord | null>(null);
  const [customTasks, setCustomTasks] = useState<Task[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [filter, setFilter] = useState<TaskListFilter>("all");
  const [selectedTask, setSelectedTask] = useState<ProductionTaskView | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [taskInput, setTaskInput] = useState<TaskCreateInput>(emptyTaskInput);
  const [categoryMap, setCategoryMap] = useState<Record<string, string[]>>({});
  const today = getTokyoDateString();

  useEffect(() => {
    let active = true;
    void Promise.all([getProjectPerformanceData(projectId), getTasks(projectId), getCategories(), getProjectMembers(projectId)]).then(([projectRecord, items, categories, projectMembers]) => {
      if (active) { setProject(projectRecord); setCustomTasks(items); setCategoryMap(toCategoryMap(categories)); setMembers(projectMembers); }
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
      await toggleTask(projectId, task.customTaskId, done, actor.uid);
      setCustomTasks((current) => current.map((item) => item.id === task.customTaskId ? { ...item, done, status: done ? "complete" : "not-started" } : item));
      const next = { ...task, status: done ? "complete" as const : "not-started" as const };
      setSelectedTask(next);
    } finally { setSaving(false); }
  }

  function handleOpenTask(task: ProductionTaskView) {
    if (task.source === "customTask") setSelectedTask(task);
    else router.push(task.editTarget);
  }

  function resetTaskForm() {
    setTaskInput(emptyTaskInput);
    setEditingTaskId(null);
    setShowCreate(false);
  }

  function handleEditTask(task: ProductionTaskView) {
    if (!task.customTaskId || !canEdit) return;
    const item = customTasks.find((candidate) => candidate.id === task.customTaskId);
    if (!item) return;
    setTaskInput(taskToInput(item));
    setEditingTaskId(item.id);
    setShowCreate(true);
    setSelectedTask(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEdit) return;
    const values = buildTaskCreateInput(taskInput);
    if (!values) { setError("タスク名を入力してください。"); return; }
    setCreating(true); setError("");
    try {
      if (editingTaskId) {
        await updateTask(projectId, editingTaskId, values, actor.uid);
        setCustomTasks((current) => current.map((item) => item.id === editingTaskId
          ? { ...item, ...values, relatedView: values.relatedView || undefined, source: "custom", done: values.status === "complete", updatedByUid: actor.uid }
          : item));
      } else {
        const id = await addTask(projectId, values, actor.uid);
        setCustomTasks((current) => [...current, {
          id, ...values, relatedView: values.relatedView || undefined, source: "custom", done: values.status === "complete", createdByUid: actor.uid, updatedByUid: actor.uid,
        }]);
      }
      resetTaskForm();
    } catch { setError(editingTaskId ? "タスクを更新できませんでした。" : "タスクを追加できませんでした。"); }
    finally { setCreating(false); }
  }

  async function handleDeleteTask(task: ProductionTaskView) {
    if (!canEdit || !task.customTaskId || saving) return;
    if (!window.confirm(`「${task.title}」を削除しますか？\n\nこの操作は取り消せません。`)) return;
    setSaving(true); setError("");
    try {
      await deleteTask(projectId, task.customTaskId, actor.uid);
      setCustomTasks((current) => current.filter((item) => item.id !== task.customTaskId));
      setSelectedTask(null);
    } catch { setError("タスクを削除できませんでした。"); }
    finally { setSaving(false); }
  }

  return <main className={styles.page}>
    <header className={styles.heading}>
      <div><p>PRODUCTION TASKS</p><h1>タスク一覧</h1><span>制作作業を期限順に確認し、処理するための一覧です。</span></div>
      <div className={styles.headingActions}>{canEdit && <button type="button" onClick={() => { if (showCreate) resetTaskForm(); else { setEditingTaskId(null); setTaskInput(emptyTaskInput); setShowCreate(true); } }}>＋ タスクを追加</button>}<Link href={`/projects/${projectId}#production-roadmap`}>ロードマップを見る</Link></div>
    </header>
    {showCreate && canEdit && <form className={styles.createPanel} onSubmit={handleCreateTask}>
      <div className={styles.formHeading}><strong>{editingTaskId ? "追加タスクを編集" : "追加タスクを作成"}</strong><span>この公演だけで使用するタスクです。</span></div>
      <label className={styles.taskTitle}><span>タスク名</span><input autoFocus required value={taskInput.title} onChange={(event) => setTaskInput((current) => ({ ...current, title: event.target.value }))} /></label>
      <label><span>期限</span><input type="date" value={taskInput.dueDate} onChange={(event) => setTaskInput((current) => ({ ...current, dueDate: event.target.value }))} /></label>
      <label><span>状態</span><select value={taskInput.status} onChange={(event) => setTaskInput((current) => ({ ...current, status: event.target.value as TaskCreateInput["status"] }))}>{Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>優先度</span><select value={taskInput.priority} onChange={(event) => setTaskInput((current) => ({ ...current, priority: event.target.value as TaskCreateInput["priority"] }))}>{Object.entries(TASK_PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span>区分</span><input list="task-category-options" placeholder="例：制作" value={taskInput.category_parent} onChange={(event) => setTaskInput((current) => ({ ...current, category_parent: event.target.value, category_child: "" }))} /><datalist id="task-category-options">{Object.keys(categoryMap).map((category) => <option key={category} value={category} />)}</datalist></label>
      <label><span>詳細カテゴリ</span><select disabled={!taskInput.category_parent} value={taskInput.category_child} onChange={(event) => setTaskInput((current) => ({ ...current, category_child: event.target.value }))}><option value="">未設定</option>{(categoryMap[taskInput.category_parent] ?? []).map((category) => <option key={category} value={category}>{category}</option>)}</select></label>
      <label><span>担当者</span><select value={taskInput.assigneeUid} onChange={(event) => { const member = members.find(({ uid }) => uid === event.target.value); setTaskInput((current) => ({ ...current, assigneeUid: event.target.value, assigneeName: member?.displayName ?? member?.email ?? "" })); }}><option value="">未設定</option>{members.map((member) => <option key={member.uid} value={member.uid}>{member.displayName || member.email || "名前未設定"}</option>)}</select></label>
      <label><span>時期</span><select value={taskInput.stage} onChange={(event) => setTaskInput((current) => ({ ...current, stage: event.target.value }))}><option value="">未設定</option><option value="前期">前期</option><option value="中期">中期</option><option value="後期">後期</option><option value="当日">当日</option></select></label>
      <label><span>関連画面</span><select value={taskInput.relatedView} onChange={(event) => setTaskInput((current) => ({ ...current, relatedView: event.target.value as TaskRelatedView | "" }))}><option value="">なし</option>{TASK_RELATED_VIEW_DEFINITIONS.map((definition) => <option key={definition.id} value={definition.id}>{definition.label}</option>)}</select></label>
      <label className={styles.taskNote}><span>メモ</span><textarea rows={3} value={taskInput.note} onChange={(event) => setTaskInput((current) => ({ ...current, note: event.target.value }))} /></label>
      <div className={styles.createActions}><button type="button" onClick={resetTaskForm}>キャンセル</button><button type="submit" disabled={creating}>{creating ? "保存中…" : editingTaskId ? "変更を保存" : "追加する"}</button></div>
    </form>}
    <nav className={styles.filters} aria-label="タスク絞り込み">{filters.map((item) => <button aria-pressed={filter === item.value} key={item.value} onClick={() => setFilter(item.value)} type="button">{item.label}</button>)}</nav>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <p className={styles.empty}>読み込み中…</p> : filtered.length === 0 ? <p className={styles.empty}>条件に一致するタスクはありません。</p> : <>
      <div className={styles.tableWrap}><table><thead><tr><th>期限</th><th>タスク名</th><th>担当</th><th>状態</th></tr></thead><tbody>{filtered.map((task) => {
        const warning = getTaskDeadlineWarning(task, today); const status = getTaskProgressStatus(task);
        return <tr key={task.id} data-warning={warning} tabIndex={0} onClick={() => handleOpenTask(task)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") handleOpenTask(task); }}>
          <td><time>{formatTaskDueDate(getTaskDueDate(task))}</time>{warning !== "none" && <small>{TASK_WARNING_LABELS[warning]}</small>}</td>
          <td><strong>{task.title || "名称未設定のタスク"}</strong><span>{[task.sectionLabel, task.detailLabel].filter(Boolean).join(" / ")}{task.custom && <em className={styles.customBadge}>追加タスク</em>}{task.priority === "high" && <em className={styles.priorityBadge}>優先度高</em>}</span></td>
          <td>{getTaskAssignee(task)}</td><td><span className={styles.status} data-status={status}>{TASK_STATUS_LABELS[status]}</span></td>
        </tr>;
      })}</tbody></table></div>
      <div className={styles.cards}>{filtered.map((task) => {
        const warning = getTaskDeadlineWarning(task, today); const status = getTaskProgressStatus(task);
        return <button type="button" key={task.id} data-warning={warning} onClick={() => handleOpenTask(task)}><span className={styles.cardTop}><time>{formatTaskDueDate(getTaskDueDate(task))}</time>{warning !== "none" && <em>{TASK_WARNING_LABELS[warning]}</em>}</span><strong>{task.title || "名称未設定のタスク"}</strong><span>{task.sectionLabel}{task.custom ? "・追加タスク" : ""}{task.priority === "high" ? "・優先度高" : ""}</span><span>担当：{getTaskAssignee(task)}</span><span className={styles.status} data-status={status}>{TASK_STATUS_LABELS[status]}</span></button>;
      })}</div>
    </>}
    <TaskDetailDrawer task={selectedTask} canEdit={canEdit} saving={saving} onClose={() => setSelectedTask(null)} onToggleComplete={handleToggleComplete} onEdit={handleEditTask} onDelete={handleDeleteTask} />
  </main>;
}
