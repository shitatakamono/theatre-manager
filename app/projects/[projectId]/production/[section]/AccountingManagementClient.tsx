"use client";

import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { normalizeAccounting, type AccountingItem, type AccountingManagement } from "@/lib/production-management";
import { CheckboxField, CheckList, DetailList, EditorDrawer, Field, ManagementSection, ProductionHeader, ReferencePanel, SectionNav, TextareaField, createId, displayValue, numberOrUndefined, styles, useProductionEditor } from "./ProductionCommon";

type Block = keyof AccountingManagement & string;
const labels: Record<Block, string> = { budget: "予算概要", expenses: "支出", incomes: "収入", sales: "公演当日売上", closing: "公演後精算" };
const links = Object.entries(labels).map(([id, label]) => ({ id, label }));
const money = (value?: number) => value === undefined ? "未設定" : `${value.toLocaleString()}円`;

export function AccountingManagementClient({ project, management }: { project: ProjectPerformanceRecord; management?: AccountingManagement }) {
  const editor = useProductionEditor(project.id, "accounting", normalizeAccounting(management));
  const basic = project.data.performanceInfo;
  const shows = project.data.performances ?? [];
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";
  const patch = <K extends Exclude<Block, "expenses" | "incomes">>(block: K, value: Partial<NonNullable<AccountingManagement[K]>>) => editor.setDraft((current) => ({ ...current, [block]: { ...(current[block] as object), ...value } }));
  const updateItem = (block: "expenses" | "incomes", index: number, value: Partial<AccountingItem>) => editor.setDraft((current) => ({ ...current, [block]: (current[block] ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) }));

  return <main className={styles.page}>
    <ProductionHeader projectId={project.id} title={title} sectionTitle="会計" eyebrow="PRODUCTION / ACCOUNTING" />
    <ReferencePanel items={[{ label: "公演名称", value: displayValue(basic?.performanceName) }, { label: "公演回数", value: `${shows.length}公演` }, { label: "チケット", value: project.data.tickets ? project.data.tickets.isPaid ? "有料" : "無料" : "未設定" }]} />
    {editor.message && <p className={styles.successMessage}>{editor.message}</p>}<SectionNav links={links} />
    <div className={styles.content}>
      <ManagementSection id="budget" title={labels.budget} block="budget" onEdit={editor.open}><DetailList items={[{ label: "総予算", value: money(editor.data.budget?.budgetTotal) }, { label: "見込収入", value: money(editor.data.budget?.expectedIncome) }, { label: "見込支出", value: money(editor.data.budget?.expectedExpense) }]} /></ManagementSection>
      <ManagementSection id="expenses" title={labels.expenses} block="expenses" onEdit={editor.open}>{renderItems(editor.data.expenses ?? [], true)}</ManagementSection>
      <ManagementSection id="incomes" title={labels.incomes} block="incomes" onEdit={editor.open}>{renderItems(editor.data.incomes ?? [], false)}</ManagementSection>
      <ManagementSection id="sales" title={labels.sales} block="sales" onEdit={editor.open}><DetailList items={[{ label: "チケット売上", value: money(editor.data.sales?.ticketSales) }, { label: "物販売上", value: money(editor.data.sales?.merchandiseSales) }, { label: "合計", value: money((editor.data.sales?.ticketSales ?? 0) + (editor.data.sales?.merchandiseSales ?? 0)) }]} /></ManagementSection>
      <ManagementSection id="closing" title={labels.closing} block="closing" onEdit={editor.open}><CheckList items={[{ label: "現金精算", complete: editor.data.closing?.cashSettled }, { label: "スタッフ支払", complete: editor.data.closing?.staffPaymentsCompleted }, { label: "収支締め", complete: editor.data.closing?.closingCompleted }]} />{editor.data.closing?.note && <p className={styles.note}>{editor.data.closing.note}</p>}</ManagementSection>
    </div>
    {editor.active && <EditorDrawer title={labels[editor.active]} saving={editor.saving} error={editor.error} onClose={editor.close} onSave={() => editor.save(labels[editor.active!])}>{renderEditor()}</EditorDrawer>}
  </main>;

  function renderItems(items: AccountingItem[], expense: boolean) {
    if (items.length === 0) return <p className={styles.empty}>{expense ? "支出" : "収入"}項目はありません。</p>;
    return <ul className={styles.accountingList}>{items.map((item) => <li key={item.id}><span data-complete={expense ? item.paid : true}>{expense ? item.paid ? "支払済" : "未払い" : "収入"}</span><strong>{item.name || "内容未設定"}</strong><em>{money(item.amount)}</em><small>{[item.category, expense && item.deadline ? `期限 ${item.deadline}` : ""].filter(Boolean).join(" / ")}</small>{item.note && <p>{item.note}</p>}</li>)}</ul>;
  }

  function renderEditor() {
    const draft = editor.draft;
    switch (editor.active) {
      case "budget": { const value = draft.budget ?? {}; return <div className={styles.formGrid}><Field label="総予算" type="number" min={0} value={value.budgetTotal ?? ""} onChange={(v) => patch("budget", { budgetTotal: numberOrUndefined(v) })} /><Field label="見込収入" type="number" min={0} value={value.expectedIncome ?? ""} onChange={(v) => patch("budget", { expectedIncome: numberOrUndefined(v) })} /><Field label="見込支出" type="number" min={0} value={value.expectedExpense ?? ""} onChange={(v) => patch("budget", { expectedExpense: numberOrUndefined(v) })} /></div>; }
      case "expenses": return renderRepeater("expenses", draft.expenses ?? [], true);
      case "incomes": return renderRepeater("incomes", draft.incomes ?? [], false);
      case "sales": { const value = draft.sales ?? {}; return <div className={styles.formGrid}><Field label="チケット売上" type="number" min={0} value={value.ticketSales ?? ""} onChange={(v) => patch("sales", { ticketSales: numberOrUndefined(v) })} /><Field label="物販売上" type="number" min={0} value={value.merchandiseSales ?? ""} onChange={(v) => patch("sales", { merchandiseSales: numberOrUndefined(v) })} /></div>; }
      case "closing": { const value = draft.closing ?? {}; return <div className={styles.formGrid}><CheckboxField label="現金精算済" checked={value.cashSettled ?? false} onChange={(checked) => patch("closing", { cashSettled: checked })} /><CheckboxField label="スタッフ支払完了" checked={value.staffPaymentsCompleted ?? false} onChange={(checked) => patch("closing", { staffPaymentsCompleted: checked })} /><CheckboxField label="収支締め完了" checked={value.closingCompleted ?? false} onChange={(checked) => patch("closing", { closingCompleted: checked })} /><TextareaField label="備考" value={value.note ?? ""} onChange={(v) => patch("closing", { note: v })} /></div>; }
      default: return null;
    }
  }

  function renderRepeater(block: "expenses" | "incomes", items: AccountingItem[], expense: boolean) {
    return <div className={styles.repeater}>{items.map((item, index) => <div className={styles.repeaterItem} key={item.id}><div className={styles.repeaterHeader}><strong>{expense ? "支出" : "収入"} {index + 1}</strong><button onClick={() => editor.setDraft((current) => ({ ...current, [block]: (current[block] ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>削除</button></div><div className={styles.formGrid}><Field label="分類" value={item.category ?? ""} onChange={(v) => updateItem(block, index, { category: v })} /><Field label="内容" value={item.name} onChange={(v) => updateItem(block, index, { name: v })} /><Field label="金額" type="number" min={0} value={item.amount ?? ""} onChange={(v) => updateItem(block, index, { amount: numberOrUndefined(v) })} />{expense && <><Field label="支払期限" type="date" value={item.deadline ?? ""} onChange={(v) => updateItem(block, index, { deadline: v })} /><CheckboxField label="支払済" checked={item.paid ?? false} onChange={(checked) => updateItem(block, index, { paid: checked })} full /></>}<TextareaField label="備考" value={item.note ?? ""} onChange={(v) => updateItem(block, index, { note: v })} /></div></div>)}<button className={styles.addButton} onClick={() => editor.setDraft((current) => ({ ...current, [block]: [...(current[block] ?? []), { id: createId(), name: "", ...(expense ? { paid: false } : {}) }] }))}>＋{expense ? "支出" : "収入"}を追加</button></div>;
  }
}
