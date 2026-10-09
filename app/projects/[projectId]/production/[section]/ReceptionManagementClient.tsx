"use client";

import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { calculateEndTime, formatPerformanceDate } from "@/lib/performance";
import { normalizeReception, type ReceptionManagement, type ReceptionScheduleItem, type TicketManagement } from "@/lib/production-management";
import { CheckboxField, CheckList, DetailList, EditorDrawer, Field, ManagementSection, ProductionHeader, ReferencePanel, SectionNav, TextareaField, createId, displayValue, numberOrUndefined, styles, useProductionEditor } from "./ProductionCommon";

type Block = keyof ReceptionManagement & string;
const labels: Record<Block, string> = { basic: "当日基本情報", staff: "受付スタッフ", preparations: "受付準備", timetable: "当日タイムスケジュール", opening: "開場前確認" };
const links = Object.entries(labels).map(([id, label]) => ({ id, label }));

export function ReceptionManagementClient({ project, management, ticketManagement }: { project: ProjectPerformanceRecord; management?: ReceptionManagement; ticketManagement?: TicketManagement }) {
  const editor = useProductionEditor(project.id, "reception", normalizeReception(management));
  const basicInfo = project.data.performanceInfo;
  const shows = project.data.performances ?? [];
  const venue = project.data.venue;
  const tickets = project.data.tickets;
  const title = basicInfo?.title || project.legacyTitle || "公演タイトル未設定";
  const patch = <K extends Exclude<Block, "timetable">>(block: K, value: Partial<NonNullable<ReceptionManagement[K]>>) => editor.setDraft((current) => ({ ...current, [block]: { ...(current[block] as object), ...value } }));
  const preparations = editor.data.preparations ?? {};
  const prepLabels = { receptionList: "受付リスト", guestList: "ゲストリスト", cashFloat: "釣銭", register: "レジ", program: "当日パンフ", questionnaire: "アンケート", stationery: "文房具", firstAid: "救急用品", catering: "ケータリング" } as const;
  const ticketSummary = !tickets
    ? "未設定"
    : !tickets.isPaid
      ? "無料"
      : [
          tickets.advanceGeneral !== undefined && `前売一般 ${tickets.advanceGeneral.toLocaleString()}円`,
          tickets.advanceStudent !== undefined && `前売学生 ${tickets.advanceStudent.toLocaleString()}円`,
          tickets.doorGeneral !== undefined && `当日一般 ${tickets.doorGeneral.toLocaleString()}円`,
          tickets.doorStudent !== undefined && `当日学生 ${tickets.doorStudent.toLocaleString()}円`,
        ].filter(Boolean).join(" / ") || "有料（料金未設定）";

  const updateSchedule = (index: number, value: Partial<ReceptionScheduleItem>) => editor.setDraft((current) => ({ ...current, timetable: (current.timetable ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) }));

  return <main className={styles.page}>
    <ProductionHeader projectId={project.id} title={title} sectionTitle="当日受付" eyebrow="PRODUCTION / RECEPTION" />
    <ReferencePanel items={[{ label: "日時", value: shows.map((show) => `${formatPerformanceDate(show.date)} 開場${show.openTime || "--:--"} 開演${show.startTime || "--:--"} 終演${show.endTimeOverride || calculateEndTime(show.startTime, basicInfo?.durationMinutes) || "--:--"}`).join(" / ") || "未設定" }, { label: "会場", value: displayValue(venue?.name) }, { label: "料金", value: ticketSummary }, { label: "販売・座席", value: [ticketManagement?.sales?.doorTicketAvailable ? "当日券あり" : "当日券なし", ticketManagement?.sales?.seatingType === "free" ? "自由席" : ticketManagement?.sales?.seatingType === "reserved" ? "指定席" : "座席未設定"].join(" / ") }, { label: "予約運用", value: [ticketManagement?.reservations?.holdsAvailable && "取り置き", ticketManagement?.reservations?.invitationsAvailable && "招待", ticketManagement?.reservations?.guestListUsed && "ゲストリスト"].filter(Boolean).join(" / ") || "未設定" }]} />
    {editor.message && <p className={styles.successMessage}>{editor.message}</p>}<SectionNav links={links} />
    <div className={styles.content}>
      <ManagementSection id="basic" title={labels.basic} block="basic" onEdit={editor.open}><DetailList items={[{ label: "集合時間", value: displayValue(editor.data.basic?.gatheringTime) }, { label: "受付開始時間", value: displayValue(editor.data.basic?.receptionStartTime) }]} /></ManagementSection>
      <ManagementSection id="staff" title={labels.staff} block="staff" onEdit={editor.open}><DetailList items={[{ label: "受付責任者", value: displayValue(editor.data.staff?.receptionLeader) }, { label: "受付人数", value: editor.data.staff?.receptionStaffCount === undefined ? "未設定" : `${editor.data.staff.receptionStaffCount}名` }, { label: "客席案内", value: displayValue(editor.data.staff?.audienceGuide) }, { label: "物販担当", value: displayValue(editor.data.staff?.merchStaff) }]} /></ManagementSection>
      <ManagementSection id="preparations" title={labels.preparations} block="preparations" onEdit={editor.open}><CheckList items={Object.entries(prepLabels).map(([key, label]) => ({ label, complete: preparations[key as keyof typeof prepLabels] }))} /></ManagementSection>
      <ManagementSection id="timetable" title={labels.timetable} block="timetable" onEdit={editor.open}>{(editor.data.timetable ?? []).length === 0 ? <p className={styles.empty}>予定は登録されていません。</p> : <ul className={styles.scheduleList}>{(editor.data.timetable ?? []).map((item) => <li key={item.id}><time>{item.time || "--:--"}</time><strong>{item.content || "内容未設定"}</strong><span>{item.responsible || "担当未設定"}</span>{item.note && <p>{item.note}</p>}</li>)}</ul>}</ManagementSection>
      <ManagementSection id="opening" title={labels.opening} block="opening" onEdit={editor.open}><CheckList items={[{ label: "開場前確認完了", complete: editor.data.opening?.openingCheckCompleted }]} />{editor.data.opening?.note && <p className={styles.note}>{editor.data.opening.note}</p>}</ManagementSection>
    </div>
    {editor.active && <EditorDrawer title={labels[editor.active]} saving={editor.saving} error={editor.error} onClose={editor.close} onSave={() => editor.save(labels[editor.active!])}>{renderEditor()}</EditorDrawer>}
  </main>;

  function renderEditor() {
    const draft = editor.draft;
    switch (editor.active) {
      case "basic": { const value = draft.basic ?? {}; return <div className={styles.formGrid}><Field label="集合時間" type="time" value={value.gatheringTime ?? ""} onChange={(v) => patch("basic", { gatheringTime: v })} /><Field label="受付開始時間" type="time" value={value.receptionStartTime ?? ""} onChange={(v) => patch("basic", { receptionStartTime: v })} /></div>; }
      case "staff": { const value = draft.staff ?? {}; return <div className={styles.formGrid}><Field label="受付責任者" value={value.receptionLeader ?? ""} onChange={(v) => patch("staff", { receptionLeader: v })} /><Field label="受付人数" type="number" min={0} value={value.receptionStaffCount ?? ""} onChange={(v) => patch("staff", { receptionStaffCount: numberOrUndefined(v) })} /><Field label="客席案内" value={value.audienceGuide ?? ""} onChange={(v) => patch("staff", { audienceGuide: v })} /><Field label="物販担当" value={value.merchStaff ?? ""} onChange={(v) => patch("staff", { merchStaff: v })} /></div>; }
      case "preparations": { const value = draft.preparations ?? {}; return <div className={styles.formGrid}>{Object.entries(prepLabels).map(([key, label]) => <CheckboxField key={key} label={label} checked={value[key as keyof typeof prepLabels] ?? false} onChange={(checked) => patch("preparations", { [key]: checked })} />)}</div>; }
      case "timetable": return <div className={styles.repeater}>{(draft.timetable ?? []).map((item, index) => <div className={styles.repeaterItem} key={item.id}><div className={styles.repeaterHeader}><strong>予定 {index + 1}</strong><button onClick={() => editor.setDraft((current) => ({ ...current, timetable: (current.timetable ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>削除</button></div><div className={styles.formGrid}><Field label="時刻" type="time" value={item.time ?? ""} onChange={(v) => updateSchedule(index, { time: v })} /><Field label="内容" value={item.content} onChange={(v) => updateSchedule(index, { content: v })} /><Field label="担当" value={item.responsible ?? ""} onChange={(v) => updateSchedule(index, { responsible: v })} /><TextareaField label="備考" value={item.note ?? ""} onChange={(v) => updateSchedule(index, { note: v })} /></div></div>)}<button className={styles.addButton} onClick={() => editor.setDraft((current) => ({ ...current, timetable: [...(current.timetable ?? []), { id: createId(), content: "" }] }))}>＋予定を追加</button></div>;
      case "opening": { const value = draft.opening ?? {}; return <div className={styles.formGrid}><CheckboxField label="開場前確認完了" checked={value.openingCheckCompleted ?? false} onChange={(checked) => patch("opening", { openingCheckCompleted: checked })} full /><TextareaField label="備考" value={value.note ?? ""} onChange={(v) => patch("opening", { note: v })} /></div>; }
      default: return null;
    }
  }
}
