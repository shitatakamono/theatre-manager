"use client";

import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { calculateTotalSeats, formatPerformanceDate, resolveSeatsPerPerformance } from "@/lib/performance";
import {
  normalizeAccounting,
  normalizeReception,
  type AccountingManagement,
  type CustomChecklistItem,
  type ReceptionManagement,
  type ReceptionPerformanceClosing,
  type ReceptionScheduleItem,
  type ReceptionStaff,
} from "@/lib/production-management";
import {
  CheckboxField,
  CheckList,
  DetailList,
  EditorDrawer,
  Field,
  ManagementSection,
  ProductionHeader,
  ReferencePanel,
  SectionNav,
  TextareaField,
  createId,
  displayValue,
  styles,
  useProductionEditor,
} from "./ProductionCommon";

type Block = Exclude<keyof ReceptionManagement, "closing"> & string;
const labels: Record<Block, string> = {
  basic: "当日運営参考",
  staff: "受付スタッフ",
  operation: "受付運用",
  preparations: "受付準備",
  merchandise: "物販準備",
  timetable: "当日タイムスケジュール",
  opening: "開場前確認",
  closingByPerformance: "公演回ごとの終演後確認",
};
const links = Object.entries(labels).map(([id, label]) => ({ id, label }));

const basicPreparationLabels = {
  receptionList: "受付名簿",
  guestList: "招待・ゲストリスト",
  program: "パンフレット",
  questionnaire: "アンケート",
  stationery: "筆記具",
  firstAid: "救急用品",
  otherSupplies: "その他受付備品",
} as const;
const merchandiseLabels = {
  productRegistration: "販売商品登録・確認",
  inventoryRegistration: "在庫登録・確認",
  salesArea: "売場準備",
  pricePop: "値札・POP準備",
  delivery: "商品搬入確認",
} as const;

export function ReceptionManagementClient({ project, management, accountingManagement }: { project: ProjectPerformanceRecord; management?: ReceptionManagement; accountingManagement?: AccountingManagement }) {
  const shows = project.data.performances ?? [];
  const editor = useProductionEditor<"reception", Block>(project.id, "reception", normalizeReception(management, shows.map((show) => show.id)));
  const title = project.data.performanceInfo?.title || project.legacyTitle || "公演タイトル未設定";
  const seatsPerPerformance = resolveSeatsPerPerformance(project.data.performanceInfo, shows.length);
  const totalSeats = calculateTotalSeats(project.data.performanceInfo, shows.length);
  const operation = editor.data.operation ?? {};
  const members = editor.data.staff?.members ?? [];
  const staffCount = members.length + (editor.data.staff?.leader?.trim() ? 1 : 0);
  const cashFloatTask = normalizeAccounting(accountingManagement).tasks?.find((task) => task.id === "standard-cash-float");

  const patch = <K extends Exclude<Block, "staff" | "timetable" | "closingByPerformance">>(block: K, value: Partial<NonNullable<ReceptionManagement[K]>>) =>
    editor.setDraft((current) => ({ ...current, [block]: { ...(current[block] as object), ...value } }));
  const updateSchedule = (index: number, value: Partial<ReceptionScheduleItem>) => editor.setDraft((current) => ({ ...current, timetable: (current.timetable ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) }));
  const updateStaff = (index: number, value: Partial<ReceptionStaff>) => editor.setDraft((current) => ({ ...current, staff: { ...current.staff, members: (current.staff?.members ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) } }));
  const updateClosing = (performanceId: string, value: Partial<ReceptionPerformanceClosing>) => editor.setDraft((current) => {
    const entries = current.closingByPerformance ?? [];
    const exists = entries.some((entry) => entry.performanceId === performanceId);
    return { ...current, closingByPerformance: exists ? entries.map((entry) => entry.performanceId === performanceId ? { ...entry, ...value } : entry) : [...entries, { performanceId, ...value }] };
  });

  const preparationItems = [
    ...Object.entries(basicPreparationLabels).map(([key, label]) => ({ label, complete: editor.data.preparations?.[key as keyof typeof basicPreparationLabels] as boolean | undefined })),
    ...(operation.pos ? [{ label: "レジ・会計手段の準備", complete: editor.data.preparations?.register }] : []),
    ...(operation.cashless ? [{ label: "決済端末・決済手段の準備", complete: editor.data.preparations?.cashlessReady }] : []),
    ...(editor.data.preparations?.customItems ?? []).map((item) => ({ label: item.label || "名称未設定", complete: item.checked })),
  ];

  return <main className={styles.page}>
    <ProductionHeader projectId={project.id} title={title} sectionTitle="当日受付" eyebrow="PRODUCTION / RECEPTION" />
    <ReferencePanel title="当日運営参考（公演情報・会計から参照）" items={[
      { label: "1公演あたり", value: seatsPerPerformance === undefined ? "未設定" : `${seatsPerPerformance.toLocaleString()}席` },
      { label: `全${shows.length}公演`, value: totalSeats === undefined ? "未算出" : `${totalSeats.toLocaleString()}席` },
      { label: "釣銭準備", value: operation.cash ? cashFloatTask?.completed ? "完了" : "未完了" : "現金利用なし" },
    ]} />
    {editor.message && <p className={styles.successMessage}>{editor.message}</p>}
    <SectionNav links={links} />
    <div className={styles.content}>
      <ManagementSection id="basic" title={labels.basic} block="basic" onEdit={editor.open}><DetailList items={[...shows.map((show) => ({ label: `${formatPerformanceDate(show.date)} ${show.startTime || "--:--"}`, value: `開場 ${show.openTime || "--:--"}` })), { label: "集合時間", value: displayValue(editor.data.basic?.gatheringTime) }, { label: "受付開始時間", value: displayValue(editor.data.basic?.receptionStartTime) }]} /></ManagementSection>
      <ManagementSection id="staff" title={`${labels.staff}（${staffCount}名）`} block="staff" onEdit={editor.open}><DetailList items={[{ label: "受付責任者", value: displayValue(editor.data.staff?.leader) }]} />{members.length === 0 ? <p className={styles.empty}>その他スタッフは登録されていません。</p> : <ul className={styles.staffList}>{members.map((member) => <li key={member.id}><strong>{member.role || "役割未設定"}</strong><span>{member.name || "氏名未設定"}</span>{member.note && <small>{member.note}</small>}</li>)}</ul>}</ManagementSection>
      <ManagementSection id="operation" title={labels.operation} block="operation" onEdit={editor.open}><CheckList items={[{ label: "現金", complete: operation.cash }, { label: "POS／レジシステム", complete: operation.pos }, { label: "キャッシュレス決済", complete: operation.cashless }, { label: "その他", complete: operation.other }]} /><DetailList items={[{ label: "使用サービス・機器", value: displayValue(operation.services) }]} /></ManagementSection>
      <ManagementSection id="preparations" title={labels.preparations} block="preparations" onEdit={editor.open}><CheckList items={preparationItems} />{operation.cash && <DetailList items={[{ label: "釣銭準備（会計TODO参照）", value: cashFloatTask?.completed ? "完了" : "未完了" }]} />}</ManagementSection>
      <ManagementSection id="merchandise" title={labels.merchandise} block="merchandise" onEdit={editor.open}>{!editor.data.merchandise?.enabled ? <p className={styles.empty}>物販なし</p> : <CheckList items={[...Object.entries(merchandiseLabels).map(([key, label]) => ({ label, complete: editor.data.merchandise?.[key as keyof typeof merchandiseLabels] as boolean | undefined })), ...(editor.data.merchandise.customItems ?? []).map((item) => ({ label: item.label || "名称未設定", complete: item.checked }))]} />}</ManagementSection>
      <ManagementSection id="timetable" title={labels.timetable} block="timetable" onEdit={editor.open}>{(editor.data.timetable ?? []).length === 0 ? <p className={styles.empty}>予定は登録されていません。</p> : <ul className={styles.scheduleList}>{(editor.data.timetable ?? []).map((item) => <li key={item.id}><time>{item.time || "--:--"}</time><strong>{item.content || "内容未設定"}</strong><span>{item.responsible || "担当未設定"}</span>{item.note && <p>{item.note}</p>}</li>)}</ul>}</ManagementSection>
      <ManagementSection id="opening" title={labels.opening} block="opening" onEdit={editor.open}><CheckList items={[{ label: "開場前確認完了", complete: editor.data.opening?.openingCheckCompleted }]} />{editor.data.opening?.note && <p className={styles.note}>{editor.data.opening.note}</p>}</ManagementSection>
      <ManagementSection id="closingByPerformance" title={labels.closingByPerformance} block="closingByPerformance" onEdit={editor.open}>{shows.length === 0 ? <p className={styles.empty}>公演回が設定されていません。</p> : <div className={styles.repeater}>{shows.map((show) => { const value = editor.data.closingByPerformance?.find((entry) => entry.performanceId === show.id); return <div className={styles.subForm} key={show.id}><strong>{formatPerformanceDate(show.date)} {show.startTime || "--:--"}</strong><CheckList items={closingItems(value, operation, editor.data.merchandise?.enabled)} /></div>; })}</div>}</ManagementSection>
    </div>
    {editor.active && <EditorDrawer title={labels[editor.active]} saving={editor.saving} error={editor.error} onClose={editor.close} onSave={() => editor.save(labels[editor.active!])}>{renderEditor()}</EditorDrawer>}
  </main>;

  function renderEditor() {
    const draft = editor.draft;
    switch (editor.active) {
      case "basic": { const value = draft.basic ?? {}; return <div className={styles.formGrid}><Field label="集合時間" type="time" value={value.gatheringTime ?? ""} onChange={(v) => patch("basic", { gatheringTime: v })} /><Field label="受付開始時間" type="time" value={value.receptionStartTime ?? ""} onChange={(v) => patch("basic", { receptionStartTime: v })} /></div>; }
      case "staff": return <div className={styles.repeater}><Field label="受付責任者 氏名" value={draft.staff?.leader ?? ""} onChange={(leader) => editor.setDraft((current) => ({ ...current, staff: { ...current.staff, leader } }))} />{(draft.staff?.members ?? []).map((member, index) => <div className={styles.repeaterItem} key={member.id}><div className={styles.repeaterHeader}><strong>その他スタッフ {index + 1}</strong><button onClick={() => editor.setDraft((current) => ({ ...current, staff: { ...current.staff, members: (current.staff?.members ?? []).filter((_, itemIndex) => itemIndex !== index) } }))}>削除</button></div><div className={styles.formGrid}><Field label="氏名" value={member.name} onChange={(v) => updateStaff(index, { name: v })} /><Field label="役割" value={member.role ?? ""} onChange={(v) => updateStaff(index, { role: v })} /><TextareaField label="備考" value={member.note ?? ""} onChange={(v) => updateStaff(index, { note: v })} /></div></div>)}<button className={styles.addButton} onClick={() => editor.setDraft((current) => ({ ...current, staff: { ...current.staff, members: [...(current.staff?.members ?? []), { id: createId(), name: "" }] } }))}>＋スタッフを追加</button></div>;
      case "operation": { const value = draft.operation ?? {}; return <div className={styles.formGrid}>{(["cash", "pos", "cashless", "other"] as const).map((key) => <CheckboxField key={key} label={{ cash: "現金", pos: "POS／レジシステム", cashless: "キャッシュレス決済", other: "その他" }[key]} checked={value[key] ?? false} onChange={(checked) => patch("operation", { [key]: checked })} />)}<TextareaField label="使用サービス・機器" value={value.services ?? ""} onChange={(services) => patch("operation", { services })} /></div>; }
      case "preparations": return <ChecklistEditor standard={basicPreparationLabels} value={draft.preparations ?? {}} conditional={[...(draft.operation?.pos ? [["register", "レジ・会計手段の準備"]] as const : []), ...(draft.operation?.cashless ? [["cashlessReady", "決済端末・決済手段の準備"]] as const : [])]} onStandardChange={(key, checked) => patch("preparations", { [key]: checked })} onCustomChange={(customItems) => patch("preparations", { customItems })} customItems={draft.preparations?.customItems ?? []} />;
      case "merchandise": { const value = draft.merchandise ?? {}; return <div className={styles.repeater}><CheckboxField label="物販あり" checked={value.enabled ?? false} onChange={(enabled) => patch("merchandise", { enabled })} full />{value.enabled && <ChecklistEditor standard={merchandiseLabels} value={value} onStandardChange={(key, checked) => patch("merchandise", { [key]: checked })} onCustomChange={(customItems) => patch("merchandise", { customItems })} customItems={value.customItems ?? []} />}</div>; }
      case "timetable": return <div className={styles.repeater}>{(draft.timetable ?? []).map((item, index) => <div className={styles.repeaterItem} key={item.id}><div className={styles.repeaterHeader}><strong>予定 {index + 1}</strong><button onClick={() => editor.setDraft((current) => ({ ...current, timetable: (current.timetable ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>削除</button></div><div className={styles.formGrid}><Field label="時刻" type="time" value={item.time ?? ""} onChange={(v) => updateSchedule(index, { time: v })} /><Field label="内容" value={item.content} onChange={(v) => updateSchedule(index, { content: v })} /><Field label="担当" value={item.responsible ?? ""} onChange={(v) => updateSchedule(index, { responsible: v })} /><TextareaField label="備考" value={item.note ?? ""} onChange={(v) => updateSchedule(index, { note: v })} /></div></div>)}<button className={styles.addButton} onClick={() => editor.setDraft((current) => ({ ...current, timetable: [...(current.timetable ?? []), { id: createId(), content: "" }] }))}>＋予定を追加</button></div>;
      case "opening": { const value = draft.opening ?? {}; return <div className={styles.formGrid}><CheckboxField label="開場前確認完了" checked={value.openingCheckCompleted ?? false} onChange={(checked) => patch("opening", { openingCheckCompleted: checked })} full /><TextareaField label="備考" value={value.note ?? ""} onChange={(v) => patch("opening", { note: v })} /></div>; }
      case "closingByPerformance": return <div className={styles.repeater}>{shows.map((show) => { const value = draft.closingByPerformance?.find((entry) => entry.performanceId === show.id); return <fieldset className={`${styles.formGrid} ${styles.subForm}`} key={show.id}><legend>{formatPerformanceDate(show.date)} {show.startTime || "--:--"}</legend><CheckboxField label="売上確認" checked={value?.salesChecked ?? false} onChange={(checked) => updateClosing(show.id, { salesChecked: checked })} />{draft.operation?.cash && <CheckboxField label="現金確認" checked={value?.cashChecked ?? false} onChange={(checked) => updateClosing(show.id, { cashChecked: checked })} />}{(draft.operation?.pos || draft.operation?.cashless) && <CheckboxField label="レジ・決済締め" checked={value?.registerClosed ?? false} onChange={(checked) => updateClosing(show.id, { registerClosed: checked })} />}{draft.merchandise?.enabled && <CheckboxField label="在庫確認" checked={value?.inventoryChecked ?? false} onChange={(checked) => updateClosing(show.id, { inventoryChecked: checked })} />}<ClosingCustomItems items={value?.customItems ?? []} onChange={(customItems) => updateClosing(show.id, { customItems })} /></fieldset>; })}</div>;
      default: return null;
    }
  }
}

function closingItems(value: ReceptionPerformanceClosing | undefined, operation: NonNullable<ReceptionManagement["operation"]>, merchandiseEnabled?: boolean) {
  return [{ label: "売上確認", complete: value?.salesChecked }, ...(operation.cash ? [{ label: "現金確認", complete: value?.cashChecked }] : []), ...(operation.pos || operation.cashless ? [{ label: "レジ・決済締め", complete: value?.registerClosed }] : []), ...(merchandiseEnabled ? [{ label: "在庫確認", complete: value?.inventoryChecked }] : []), ...(value?.customItems ?? []).map((item) => ({ label: item.label || "名称未設定", complete: item.checked }))];
}

function ChecklistEditor({ standard, conditional = [], value, customItems, onStandardChange, onCustomChange }: { standard: Record<string, string>; conditional?: readonly (readonly [string, string])[]; value: Record<string, unknown>; customItems: CustomChecklistItem[]; onStandardChange: (key: string, checked: boolean) => void; onCustomChange: (items: CustomChecklistItem[]) => void }) {
  const entries = [...Object.entries(standard), ...conditional];
  return <div className={styles.repeater}><div className={styles.formGrid}>{entries.map(([key, label]) => <CheckboxField key={key} label={label} checked={value[key] === true} onChange={(checked) => onStandardChange(key, checked)} />)}</div><ClosingCustomItems items={customItems} onChange={onCustomChange} /></div>;
}

function ClosingCustomItems({ items, onChange }: { items: CustomChecklistItem[]; onChange: (items: CustomChecklistItem[]) => void }) {
  return <div className={`${styles.repeater} ${styles.fullField}`}>{items.map((item, index) => <div className={styles.repeaterItem} key={item.id}><div className={styles.repeaterHeader}><strong>独自確認項目 {index + 1}</strong><button onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}>削除</button></div><div className={styles.formGrid}><CheckboxField label="確認済" checked={item.checked ?? false} onChange={(checked) => onChange(items.map((current, itemIndex) => itemIndex === index ? { ...current, checked } : current))} /><Field label="項目名" value={item.label} onChange={(label) => onChange(items.map((current, itemIndex) => itemIndex === index ? { ...current, label } : current))} /></div></div>)}<button className={styles.addButton} onClick={() => onChange([...items, { id: createId(), label: "", checked: false }])}>＋確認項目を追加</button></div>;
}
