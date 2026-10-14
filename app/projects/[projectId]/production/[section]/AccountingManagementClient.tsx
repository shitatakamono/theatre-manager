"use client";

import { useState } from "react";
import type { ProjectPerformanceRecord } from "@/lib/firestore";
import {
  normalizeAccounting,
  type AccountingManagement,
  type AccountingTask,
  type AccountingTaskPhase,
} from "@/lib/production-management";
import {
  CheckboxField,
  EditorDrawer,
  Field,
  ManagementSection,
  ProductionHeader,
  ReferencePanel,
  SectionNav,
  TextareaField,
  createId,
  styles,
  useProductionEditor,
} from "./ProductionCommon";

const phaseLabels: Record<AccountingTaskPhase, string> = {
  before: "公演前",
  day: "公演当日",
  after: "公演後",
};
const phases = Object.keys(phaseLabels) as AccountingTaskPhase[];
const links = phases.map((phase) => ({ id: phase, label: phaseLabels[phase] }));

export function AccountingManagementClient({ project, management }: { project: ProjectPerformanceRecord; management?: AccountingManagement }) {
  const editor = useProductionEditor(project.id, "accounting", normalizeAccounting(management));
  const [activePhase, setActivePhase] = useState<AccountingTaskPhase>("before");
  const basic = project.data.performanceInfo;
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";

  function openPhase(phase: AccountingTaskPhase) {
    setActivePhase(phase);
    editor.open("tasks");
  }

  function updateTask(id: string, patch: Partial<AccountingTask>) {
    editor.setDraft((current) => ({
      ...current,
      tasks: (current.tasks ?? []).map((task) => task.id === id ? { ...task, ...patch } : task),
    }));
  }

  return <main className={styles.page}>
    <ProductionHeader projectId={project.id} title={title} sectionTitle="会計" eyebrow="PRODUCTION / ACCOUNTING" />
    <ReferencePanel title="会計管理の方針" items={[
      { label: "管理対象", value: "徴収・支払・返金・入金確認・報告業務" },
      { label: "金額・仕訳の正本", value: "会計ソフト／Excel" },
      { label: "数値入力", value: "SeisakuBoardでは管理しません" },
    ]} />
    {editor.message && <p className={styles.successMessage}>{editor.message}</p>}
    <SectionNav links={links} />
    <div className={styles.content}>
      {phases.map((phase) => {
        const tasks = (editor.data.tasks ?? []).filter((task) => task.phase === phase);
        const completed = tasks.filter((task) => task.completed).length;
        return <ManagementSection key={phase} id={phase} title={`${phaseLabels[phase]}（${completed}/${tasks.length}完了）`} block={phase} onEdit={openPhase}>
          <AccountingTaskList tasks={tasks} />
        </ManagementSection>;
      })}
    </div>
    {editor.active && <EditorDrawer title={phaseLabels[activePhase]} saving={editor.saving} error={editor.error} onClose={editor.close} onSave={() => editor.save(`${phaseLabels[activePhase]}の会計TODO`)}>
      <div className={styles.repeater}>
        {(editor.draft.tasks ?? []).filter((task) => task.phase === activePhase).map((task) => <div className={styles.repeaterItem} key={task.id}>
          <div className={styles.repeaterHeader}>
            <strong>{task.label || "項目名未設定"}</strong>
            {task.custom && <button onClick={() => editor.setDraft((current) => ({ ...current, tasks: (current.tasks ?? []).filter((currentTask) => currentTask.id !== task.id) }))}>削除</button>}
          </div>
          <div className={styles.formGrid}>
            <CheckboxField label="完了" checked={task.completed ?? false} onChange={(completed) => updateTask(task.id, { completed, completedAt: completed ? new Date().toISOString() : undefined })} />
            {task.custom && <Field label="項目名" value={task.label} onChange={(label) => updateTask(task.id, { label })} />}
            {task.custom && <label className={styles.field}><span>フェーズ</span><select value={task.phase} onChange={(event) => updateTask(task.id, { phase: event.target.value as AccountingTaskPhase })}>{phases.map((phase) => <option key={phase} value={phase}>{phaseLabels[phase]}</option>)}</select></label>}
            <Field label="期限" type="date" value={task.dueDate ?? ""} onChange={(dueDate) => updateTask(task.id, { dueDate })} />
            <Field label="担当" value={task.responsible ?? ""} onChange={(responsible) => updateTask(task.id, { responsible })} />
            <TextareaField label="備考" value={task.note ?? ""} onChange={(note) => updateTask(task.id, { note })} />
          </div>
        </div>)}
        <button className={styles.addButton} onClick={() => editor.setDraft((current) => ({ ...current, tasks: [...(current.tasks ?? []), { id: createId(), label: "", phase: activePhase, custom: true, completed: false }] }))}>＋会計項目を追加</button>
      </div>
    </EditorDrawer>}
  </main>;
}

function AccountingTaskList({ tasks }: { tasks: AccountingTask[] }) {
  if (tasks.length === 0) return <p className={styles.empty}>会計項目はありません。</p>;
  return <ul className={styles.accountingList}>{tasks.map((task) => <li key={task.id}>
    <span data-complete={task.completed}>{task.completed ? "完了" : "未完了"}</span>
    <strong>{task.label || "項目名未設定"}</strong>
    <em>{task.dueDate || "期限未設定"}</em>
    <small>{task.responsible ? `担当 ${task.responsible}` : "担当未設定"}{task.note ? ` / ${task.note}` : ""}</small>
  </li>)}</ul>;
}
