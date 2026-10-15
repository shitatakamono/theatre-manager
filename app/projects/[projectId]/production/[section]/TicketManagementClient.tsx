"use client";

import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { calculateTotalSeats, formatPerformanceDate, resolveSeatsPerPerformance } from "@/lib/performance";
import { normalizeTickets, type TicketManagement } from "@/lib/production-management";
import { getProjectRevision } from "@/lib/project-revisions";
import { CheckboxField, CheckList, DetailList, EditorDrawer, Field, ManagementSection, ProductionHeader, ReferencePanel, SectionNav, TextareaField, displayValue, numberOrUndefined, styles, useProductionEditor } from "./ProductionCommon";

type Block = Exclude<keyof TicketManagement, "capacities"> & string;
const labels: Record<Block, string> = { methods: "販売方法", sales: "販売期間", reservations: "予約・招待", handoff: "当日受付への引継ぎ" };
const links = [{ id: "prices", label: "料金" }, ...Object.entries(labels).map(([id, label]) => ({ id, label }))];

export function TicketManagementClient({ project, management }: { project: ProjectPerformanceRecord; management?: TicketManagement }) {
  const editor = useProductionEditor<"tickets", Block>(project.id, "tickets", normalizeTickets(management), getProjectRevision(project.revisions, "ticket"));
  const basic = project.data.performanceInfo;
  const venue = project.data.venue;
  const shows = project.data.performances ?? [];
  const tickets = project.data.tickets;
  const seatsPerPerformance = resolveSeatsPerPerformance(basic, shows.length);
  const totalSeats = calculateTotalSeats(basic, shows.length);
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";
  const patch = <K extends Block>(block: K, value: Partial<NonNullable<TicketManagement[K]>>) => editor.setDraft((current) => ({ ...current, [block]: { ...(current[block] as object), ...value } }));
  const price = (value?: number) => value === undefined ? "未設定" : `${value.toLocaleString()}円`;

  return <main className={styles.page}>
    <ProductionHeader projectId={project.id} title={title} sectionTitle="チケット" eyebrow="PRODUCTION / TICKETS" />
    <ReferencePanel items={[{ label: "会場", value: displayValue(venue?.name) }, { label: "公演回", value: shows.map((show) => `${formatPerformanceDate(show.date)} ${show.startTime || "--:--"}`).join(" / ") || "未設定" }, { label: "1公演あたり", value: seatsPerPerformance === undefined ? "未設定" : `${seatsPerPerformance.toLocaleString()}席` }, { label: `全${shows.length}公演`, value: totalSeats === undefined ? "未算出" : `${totalSeats.toLocaleString()}席` }, { label: "料金種別", value: tickets ? tickets.isPaid ? "有料" : "無料" : "未設定" }]} />
    {editor.message && <p className={styles.successMessage}>{editor.message}</p>}<SectionNav links={links} />
    <div className={styles.content}>
      <ManagementSection id="prices" title="チケット料金（公演情報から参照）" block="methods" onEdit={editor.open} editable={false}><DetailList items={[{ label: "前売一般", value: price(tickets?.advanceGeneral) }, { label: "前売学生", value: price(tickets?.advanceStudent) }, { label: "当日一般", value: price(tickets?.doorGeneral) }, { label: "当日学生", value: price(tickets?.doorStudent) }]} /><p className={styles.description}>料金を変更する場合は「公演情報を見る」から編集してください。</p></ManagementSection>
      <ManagementSection id="methods" title={labels.methods} block="methods" onEdit={editor.open}><CheckList items={[{ label: "オンライン", complete: editor.data.methods?.online }, { label: "電話", complete: editor.data.methods?.phone }, { label: "メール", complete: editor.data.methods?.email }, { label: "紙チケット", complete: editor.data.methods?.physical }]} /><DetailList items={[{ label: "オンラインサービス", value: displayValue(editor.data.methods?.onlineService) }, { label: "販売URL", value: displayValue(editor.data.methods?.salesUrl) }]} /></ManagementSection>
      <ManagementSection id="sales" title={labels.sales} block="sales" onEdit={editor.open}><DetailList items={[{ label: "販売期間", value: `${displayValue(editor.data.sales?.salesStartDate)} 〜 ${displayValue(editor.data.sales?.salesEndDate)}` }, { label: "予約締切", value: displayValue(editor.data.sales?.reservationDeadline) }, { label: "オンライン締切", value: displayValue(editor.data.sales?.onlineDeadline) }, { label: "当日券", value: editor.data.sales?.doorTicketAvailable ? "販売あり" : "なし" }, { label: "座席方式", value: editor.data.sales?.seatingType === "free" ? "自由席" : editor.data.sales?.seatingType === "reserved" ? "指定席" : "未設定" }]} /></ManagementSection>
      <ManagementSection id="reservations" title={labels.reservations} block="reservations" onEdit={editor.open}><CheckList items={[{ label: "取り置き", complete: editor.data.reservations?.holdsAvailable }, { label: "招待", complete: editor.data.reservations?.invitationsAvailable }, { label: "関係者席", complete: editor.data.reservations?.stakeholderSeatsAvailable }, { label: "ゲストリスト", complete: editor.data.reservations?.guestListUsed }]} /><DetailList items={[{ label: "紙チケット枚数", value: editor.data.reservations?.physicalTicketQuantity === undefined ? "未設定" : `${editor.data.reservations.physicalTicketQuantity}枚` }, { label: "紙チケット担当", value: displayValue(editor.data.reservations?.physicalTicketResponsible) }]} /></ManagementSection>
      <ManagementSection id="handoff" title={labels.handoff} block="handoff" onEdit={editor.open}><CheckList items={[{ label: "受付への引継ぎ確認", complete: editor.data.handoff?.receptionHandoffConfirmed }]} />{editor.data.handoff?.note && <p className={styles.note}>{editor.data.handoff.note}</p>}</ManagementSection>
    </div>
    {editor.active && <EditorDrawer title={labels[editor.active]} saving={editor.saving} error={editor.error} conflict={editor.conflict} onReload={editor.reloadLatest} onClose={editor.close} onSave={() => editor.save(labels[editor.active!])}>{renderEditor()}</EditorDrawer>}
  </main>;

  function renderEditor() {
    const draft = editor.draft;
    switch (editor.active) {
      case "methods": { const value = draft.methods ?? {}; return <div className={styles.formGrid}>{(["online", "phone", "email", "physical"] as const).map((key) => <CheckboxField key={key} label={{ online: "オンライン", phone: "電話", email: "メール", physical: "紙チケット" }[key]} checked={value[key] ?? false} onChange={(checked) => patch("methods", { [key]: checked })} />)}<Field label="オンラインサービス" value={value.onlineService ?? ""} onChange={(v) => patch("methods", { onlineService: v })} /><Field label="販売URL" type="url" value={value.salesUrl ?? ""} onChange={(v) => patch("methods", { salesUrl: v })} /><TextareaField label="その他" value={value.other ?? ""} onChange={(v) => patch("methods", { other: v })} /></div>; }
      case "sales": { const value = draft.sales ?? {}; return <div className={styles.formGrid}><Field label="販売開始日" type="date" value={value.salesStartDate ?? ""} onChange={(v) => patch("sales", { salesStartDate: v })} /><Field label="販売終了日" type="date" value={value.salesEndDate ?? ""} onChange={(v) => patch("sales", { salesEndDate: v })} /><Field label="予約締切" type="date" value={value.reservationDeadline ?? ""} onChange={(v) => patch("sales", { reservationDeadline: v })} /><Field label="オンライン締切" type="date" value={value.onlineDeadline ?? ""} onChange={(v) => patch("sales", { onlineDeadline: v })} /><CheckboxField label="当日券あり" checked={value.doorTicketAvailable ?? false} onChange={(checked) => patch("sales", { doorTicketAvailable: checked })} /><label className={styles.field}><span>座席方式</span><select value={value.seatingType ?? ""} onChange={(event) => patch("sales", { seatingType: event.target.value as "free" | "reserved" | "" })}><option value="">未設定</option><option value="free">自由席</option><option value="reserved">指定席</option></select></label></div>; }
      case "reservations": { const value = draft.reservations ?? {}; return <div className={styles.formGrid}>{(["holdsAvailable", "invitationsAvailable", "stakeholderSeatsAvailable", "guestListUsed"] as const).map((key) => <CheckboxField key={key} label={{ holdsAvailable: "取り置きあり", invitationsAvailable: "招待あり", stakeholderSeatsAvailable: "関係者席あり", guestListUsed: "ゲストリスト使用" }[key]} checked={value[key] ?? false} onChange={(checked) => patch("reservations", { [key]: checked })} />)}<Field label="紙チケット枚数" type="number" min={0} value={value.physicalTicketQuantity ?? ""} onChange={(v) => patch("reservations", { physicalTicketQuantity: numberOrUndefined(v) })} /><Field label="紙チケット担当" value={value.physicalTicketResponsible ?? ""} onChange={(v) => patch("reservations", { physicalTicketResponsible: v })} /></div>; }
      case "handoff": { const value = draft.handoff ?? {}; return <div className={styles.formGrid}><CheckboxField label="当日受付への引継ぎ確認済" checked={value.receptionHandoffConfirmed ?? false} onChange={(checked) => patch("handoff", { receptionHandoffConfirmed: checked })} full /><TextareaField label="備考" value={value.note ?? ""} onChange={(v) => patch("handoff", { note: v })} /></div>; }
      default: return null;
    }
  }
}
