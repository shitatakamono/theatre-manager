"use client";

import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { formatPerformanceDate } from "@/lib/performance";
import { normalizeFlyer, type FlyerManagement } from "@/lib/production-management";
import {
  CheckboxField, CheckList, DetailList, EditorDrawer, Field,
  ManagementSection, ProductionHeader, ReferencePanel, SectionNav,
  TextareaField, displayValue, numberOrUndefined, styles, useProductionEditor,
} from "./ProductionCommon";

type Block = keyof FlyerManagement & string;
const labels: Record<Block, string> = { specifications: "制作仕様", information: "掲載情報確認", progress: "進行・入稿", print: "印刷・納品", distribution: "配布" };
const links = Object.entries(labels).map(([id, label]) => ({ id, label }));

export function FlyerManagementClient({ project, management }: { project: ProjectPerformanceRecord; management?: FlyerManagement }) {
  const editor = useProductionEditor(project.id, "flyer", normalizeFlyer(management));
  const basic = project.data.performanceInfo;
  const venue = project.data.venue;
  const shows = project.data.performances ?? [];
  const tickets = project.data.tickets;
  const cast = project.data.cast ?? [];
  const staff = project.data.staff ?? [];
  const credits = project.data.credits ?? [];
  const contact = project.data.contact;
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";
  const spec = editor.data.specifications ?? {};
  const info = editor.data.information ?? {};
  const progress = editor.data.progress ?? {};
  const print = editor.data.print ?? {};
  const distribution = editor.data.distribution ?? {};
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

  const patch = <K extends Block>(block: K, value: Partial<NonNullable<FlyerManagement[K]>>) => editor.setDraft((current) => ({ ...current, [block]: { ...(current[block] as object), ...value } }));

  return <main className={styles.page}>
    <ProductionHeader projectId={project.id} title={title} sectionTitle="チラシ・ポスター" eyebrow="PRODUCTION / FLYER & POSTER" />
    <ReferencePanel items={[
      { label: "公演", value: `${displayValue(basic?.performanceName)} / ${title}` },
      { label: "日時・会場", value: `${shows.map((show) => formatPerformanceDate(show.date)).join("、") || "日程未設定"} / ${displayValue(venue?.name)}` },
      { label: "上演時間", value: basic?.durationMinutes ? `${basic.durationMinutes}分` : "未設定" },
      { label: "出演・スタッフ", value: `${cast.length}名 / ${staff.length}役職` },
      { label: "料金", value: ticketSummary },
      { label: "主催・問合せ", value: [basic?.organizer, contact?.name, contact?.email].filter(Boolean).join(" / ") || "未設定" },
      { label: "掲載情報", value: credits.map((credit) => credit.displayName || credit.name).filter(Boolean).join(" / ") || "未設定" },
    ]} />
    {editor.message && <p className={styles.successMessage}>{editor.message}</p>}
    <SectionNav links={links} />
    <div className={styles.content}>
      <ManagementSection id="specifications" title={labels.specifications} block="specifications" onEdit={editor.open}>
        <DetailList items={[
          { label: "制作物", value: [spec.flyerEnabled && "チラシ", spec.posterEnabled && "ポスター"].filter(Boolean).join(" / ") || "未設定" },
          { label: "デザイナー", value: displayValue(spec.designer) },
          { label: "サイズ", value: `チラシ ${displayValue(spec.flyerSize)} / ポスター ${displayValue(spec.posterSize)}` },
          { label: "印刷仕様", value: [spec.sides, spec.color, spec.quantity !== undefined ? `${spec.quantity}部` : "", spec.dataFormat].filter(Boolean).join(" / ") || "未設定" },
          { label: "QRコード", value: spec.hasQr ? "あり" : "なし" },
        ]} />
      </ManagementSection>
      <ManagementSection id="information" title={labels.information} block="information" onEdit={editor.open}>
        <CheckList items={[{ label: "公演情報確定", complete: info.informationFinalized }, { label: "協賛等掲載情報確認", complete: info.sponsorInfoReady }, { label: "ロゴ素材準備", complete: info.logoMaterialsReady }, { label: "校正完了", complete: info.proofread }]} />
      </ManagementSection>
      <ManagementSection id="progress" title={labels.progress} block="progress" onEdit={editor.open}>
        <DetailList items={[{ label: "入稿予定日", value: displayValue(progress.submissionPlannedDate) }, { label: "入稿日", value: displayValue(progress.submissionDate) }]} />
      </ManagementSection>
      <ManagementSection id="print" title={labels.print} block="print" onEdit={editor.open}>
        <DetailList items={[{ label: "印刷会社", value: displayValue(print.printer) }, { label: "納品予定日", value: displayValue(print.deliveryPlannedDate) }, { label: "納品日", value: displayValue(print.deliveryDate) }, { label: "印刷費", value: print.printCost === undefined ? "未設定" : `${print.printCost.toLocaleString()}円` }, { label: "納品先", value: displayValue(print.deliveryDestination) }]} />
      </ManagementSection>
      <ManagementSection id="distribution" title={labels.distribution} block="distribution" onEdit={editor.open}>
        <DetailList items={[{ label: "配布開始日", value: displayValue(distribution.distributionStartDate) }]} />
        <CheckList items={[{ label: "会場", complete: distribution.venue }, { label: "施設", complete: distribution.facilities }, { label: "折込", complete: distribution.inserts }, { label: "DM", complete: distribution.dm }, { label: "出演者配布", complete: distribution.performers }]} />
        {(distribution.other || distribution.note) && <p className={styles.note}>{[distribution.other, distribution.note].filter(Boolean).join("\n")}</p>}
      </ManagementSection>
    </div>
    {editor.active && <EditorDrawer title={labels[editor.active]} saving={editor.saving} error={editor.error} onClose={editor.close} onSave={() => editor.save(labels[editor.active!])}>{renderEditor()}</EditorDrawer>}
  </main>;

  function renderEditor() {
    const draft = editor.draft;
    switch (editor.active) {
      case "specifications": { const value = draft.specifications ?? {}; return <div className={styles.formGrid}>
        <CheckboxField label="チラシを制作" checked={value.flyerEnabled ?? false} onChange={(checked) => patch("specifications", { flyerEnabled: checked })} />
        <CheckboxField label="ポスターを制作" checked={value.posterEnabled ?? false} onChange={(checked) => patch("specifications", { posterEnabled: checked })} />
        <Field label="デザイナー" value={value.designer ?? ""} onChange={(v) => patch("specifications", { designer: v })} />
        <Field label="チラシサイズ" value={value.flyerSize ?? ""} onChange={(v) => patch("specifications", { flyerSize: v })} />
        <Field label="ポスターサイズ" value={value.posterSize ?? ""} onChange={(v) => patch("specifications", { posterSize: v })} />
        <Field label="片面・両面" value={value.sides ?? ""} onChange={(v) => patch("specifications", { sides: v })} />
        <Field label="カラー" value={value.color ?? ""} onChange={(v) => patch("specifications", { color: v })} />
        <Field label="部数" type="number" min={0} value={value.quantity ?? ""} onChange={(v) => patch("specifications", { quantity: numberOrUndefined(v) })} />
        <Field label="データ形式" value={value.dataFormat ?? ""} onChange={(v) => patch("specifications", { dataFormat: v })} />
        <CheckboxField label="QRコードあり" checked={value.hasQr ?? false} onChange={(checked) => patch("specifications", { hasQr: checked })} />
      </div>; }
      case "information": { const value = draft.information ?? {}; return <div className={styles.formGrid}>
        <CheckboxField label="公演情報確定" checked={value.informationFinalized ?? false} onChange={(checked) => patch("information", { informationFinalized: checked })} />
        <CheckboxField label="協賛等掲載情報確認" checked={value.sponsorInfoReady ?? false} onChange={(checked) => patch("information", { sponsorInfoReady: checked })} />
        <CheckboxField label="ロゴ素材準備" checked={value.logoMaterialsReady ?? false} onChange={(checked) => patch("information", { logoMaterialsReady: checked })} />
        <CheckboxField label="校正完了" checked={value.proofread ?? false} onChange={(checked) => patch("information", { proofread: checked })} />
      </div>; }
      case "progress": { const value = draft.progress ?? {}; return <div className={styles.formGrid}><Field label="入稿予定日" type="date" value={value.submissionPlannedDate ?? ""} onChange={(v) => patch("progress", { submissionPlannedDate: v })} /><Field label="入稿日" type="date" value={value.submissionDate ?? ""} onChange={(v) => patch("progress", { submissionDate: v })} /></div>; }
      case "print": { const value = draft.print ?? {}; return <div className={styles.formGrid}>
        <Field label="印刷会社" value={value.printer ?? ""} onChange={(v) => patch("print", { printer: v })} /><Field label="納品予定日" type="date" value={value.deliveryPlannedDate ?? ""} onChange={(v) => patch("print", { deliveryPlannedDate: v })} /><Field label="納品日" type="date" value={value.deliveryDate ?? ""} onChange={(v) => patch("print", { deliveryDate: v })} /><Field label="印刷費" type="number" min={0} value={value.printCost ?? ""} onChange={(v) => patch("print", { printCost: numberOrUndefined(v) })} /><Field label="納品先" value={value.deliveryDestination ?? ""} onChange={(v) => patch("print", { deliveryDestination: v })} />
      </div>; }
      case "distribution": { const value = draft.distribution ?? {}; return <div className={styles.formGrid}>
        <Field label="配布開始日" type="date" value={value.distributionStartDate ?? ""} onChange={(v) => patch("distribution", { distributionStartDate: v })} />
        {(["venue", "facilities", "inserts", "dm", "performers"] as const).map((key) => <CheckboxField key={key} label={{ venue: "会場", facilities: "施設", inserts: "折込", dm: "DM", performers: "出演者配布" }[key]} checked={value[key] ?? false} onChange={(checked) => patch("distribution", { [key]: checked })} />)}
        <TextareaField label="その他" value={value.other ?? ""} onChange={(v) => patch("distribution", { other: v })} /><TextareaField label="備考" value={value.note ?? ""} onChange={(v) => patch("distribution", { note: v })} />
      </div>; }
      default: return null;
    }
  }
}
