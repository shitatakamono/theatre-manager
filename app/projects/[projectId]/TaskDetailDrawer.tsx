"use client";

import { useState } from "react";
import Link from "next/link";
import type { ProductionTaskView } from "@/lib/production-task-view";
import {
  getTaskAssignee,
  getTaskDueDate,
  getTaskProgressStatus,
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
} from "@/lib/task-view";
import styles from "./task-detail-drawer.module.css";

type TaskDetailDrawerProps = {
  task: ProductionTaskView | null;
  canEdit: boolean;
  saving?: boolean;
  onClose: () => void;
  onToggleComplete: (task: ProductionTaskView) => Promise<void>;
  onEdit?: (task: ProductionTaskView) => void;
  onDelete?: (task: ProductionTaskView) => Promise<void>;
};

export function TaskDetailDrawer({ task, canEdit, saving = false, onClose, onToggleComplete, onEdit, onDelete }: TaskDetailDrawerProps) {
  const [error, setError] = useState<{ taskId: string; message: string } | null>(null);
  if (!task) return null;

  const status = getTaskProgressStatus(task);
  const dueDate = getTaskDueDate(task);
  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
      <header>
        <div><p>TASK DETAIL</p><h2 id="task-detail-title">{task.title || "名称未設定のタスク"}</h2></div>
        <button type="button" aria-label="閉じる" onClick={onClose}>×</button>
      </header>
      <dl>
        <div><dt>期限</dt><dd>{dueDate || "未設定"}</dd></div>
        <div><dt>担当</dt><dd>{getTaskAssignee(task)}</dd></div>
        <div><dt>状態</dt><dd>{TASK_STATUS_LABELS[status]}</dd></div>
        {task.priority && <div><dt>優先度</dt><dd>{TASK_PRIORITY_LABELS[task.priority]}</dd></div>}
        <div><dt>セクション</dt><dd>{[task.sectionLabel, task.detailLabel].filter(Boolean).join(" / ")}</dd></div>
        {task.stage && <div><dt>時期</dt><dd>{task.stage}</dd></div>}
        {task.note && <div><dt>備考</dt><dd>{task.note}</dd></div>}
      </dl>
      {task.source === "customTask" && task.relatedViewHref && task.relatedViewLabel && <div className={styles.actions}>
        <p>関連画面</p>
        <Link href={task.relatedViewHref}>{task.relatedViewLabel}を開く</Link>
      </div>}
      {task.source !== "customTask" ? <div className={styles.actions}>
        <p>{canEdit ? "この仕事は制作セクションで編集します。" : "制作セクションで詳細を確認できます。"}</p>
        <Link href={task.editTarget}>{canEdit ? "制作セクションで編集" : "制作セクションを見る"}</Link>
      </div> : canEdit ? <div className={styles.actions}>
        <p>この公演だけで使用する追加タスクです。</p>
        {onEdit && <button type="button" disabled={saving} onClick={() => onEdit(task)}>内容を編集</button>}
        <button type="button" disabled={saving} onClick={() => {
          setError(null);
          void onToggleComplete(task).catch(() => setError({ taskId: task.id, message: "タスクを更新できませんでした。" }));
        }}>{saving ? "保存中…" : task.status === "complete" ? "未完了に戻す" : "完了にする"}</button>
        {onDelete && <div className={styles.dangerZone}><p>このタスクが不要になった場合のみ削除してください。</p><button type="button" disabled={saving} onClick={() => {
          setError(null);
          void onDelete(task).catch(() => setError({ taskId: task.id, message: "タスクを削除できませんでした。" }));
        }}>このタスクを削除</button></div>}
        {error?.taskId === task.id && <span role="alert">{error.message}</span>}
      </div> : <p className={styles.readOnly}>閲覧専用です。</p>}
    </aside>
  </div>;
}
