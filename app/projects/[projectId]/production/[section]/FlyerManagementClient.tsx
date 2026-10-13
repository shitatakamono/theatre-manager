"use client";

import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { formatPerformanceDate } from "@/lib/performance";
import {
  normalizeFlyer,
  type FlyerManagement,
  type PrintItemManagement,
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
  displayValue,
  numberOrUndefined,
  styles,
  useProductionEditor,
} from "./ProductionCommon";

type Block = keyof FlyerManagement & string;
const labels: Record<Block, string> = {
  specifications: "共通制作情報",
  flyer: "チラシ",
  poster: "ポスター",
  information: "掲載情報確認",
  distribution: "配布",
};
const links = Object.entries(labels).map(([id, label]) => ({ id, label }));

export function FlyerManagementClient({ project, management }: { project: ProjectPerformanceRecord; management?: FlyerManagement }) {
  const editor = useProductionEditor(project.id, "flyer", normalizeFlyer(management));
  const basic = project.data.performanceInfo;
  const shows = project.data.performances ?? [];
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";

  const patch = <K extends Block>(block: K, value: Partial<NonNullable<FlyerManagement[K]>>) =>
    editor.setDraft((current) => ({ ...current, [block]: { ...(current[block] as object), ...value } }));

  return (
    <main className={styles.page}>
      <ProductionHeader projectId={project.id} title={title} sectionTitle="チラシ・ポスター" eyebrow="PRODUCTION / FLYER & POSTER" />
      <ReferencePanel items={[
        { label: "公演", value: `${displayValue(basic?.performanceName)} / ${title}` },
        { label: "公演日時", value: shows.map((show) => formatPerformanceDate(show.date)).join("、") || "未設定" },
        { label: "会場", value: displayValue(project.data.venue?.name) },
        { label: "上演時間", value: basic?.durationMinutes ? `${basic.durationMinutes}分` : "未設定" },
      ]} />
      {editor.message && <p className={styles.successMessage}>{editor.message}</p>}
      <SectionNav links={links} />
      <div className={styles.content}>
        <ManagementSection id="specifications" title={labels.specifications} block="specifications" onEdit={editor.open}>
          <DetailList items={[
            { label: "デザイン担当", value: displayValue(editor.data.specifications?.designer) },
            { label: "表面デザイン", value: displayValue(editor.data.specifications?.surfaceDesign) },
            { label: "ポスター", value: editor.data.specifications?.posterUsesFlyerFront === false ? "独自デザイン" : "チラシ表面デザインを使用" },
          ]} />
        </ManagementSection>
        {renderPrintSection("flyer", "チラシ")}
        {renderPrintSection("poster", "ポスター")}
        <ManagementSection id="information" title={labels.information} block="information" onEdit={editor.open}>
          <CheckList items={[
            { label: "公演情報確定", complete: editor.data.information?.informationFinalized },
            { label: "協賛・後援等掲載情報確認", complete: editor.data.information?.sponsorInfoReady },
            { label: "ロゴ素材確認", complete: editor.data.information?.logoMaterialsReady },
            { label: "校正", complete: editor.data.information?.proofread },
          ]} />
        </ManagementSection>
        <ManagementSection id="distribution" title={labels.distribution} block="distribution" onEdit={editor.open}>
          <DetailList items={[{ label: "配布開始日", value: displayValue(editor.data.distribution?.distributionStartDate) }]} />
          <CheckList items={[
            { label: "会場", complete: editor.data.distribution?.venue },
            { label: "施設", complete: editor.data.distribution?.facilities },
            { label: "折込", complete: editor.data.distribution?.inserts },
            { label: "DM", complete: editor.data.distribution?.dm },
            { label: "出演者配布", complete: editor.data.distribution?.performers },
          ]} />
          {(editor.data.distribution?.other || editor.data.distribution?.note) && <p className={styles.note}>{[editor.data.distribution.other, editor.data.distribution.note].filter(Boolean).join("\n")}</p>}
        </ManagementSection>
      </div>
      {editor.active && <EditorDrawer title={labels[editor.active]} saving={editor.saving} error={editor.error} onClose={editor.close} onSave={() => editor.save(labels[editor.active!])}>{renderEditor()}</EditorDrawer>}
    </main>
  );

  function renderPrintSection(block: "flyer" | "poster", label: string) {
    const value = editor.data[block] ?? {};
    return <ManagementSection id={block} title={label} block={block} onEdit={editor.open}>
      <CheckList items={[{ label: `${label}を使用`, complete: value.enabled }]} />
      <DetailList items={[
        { label: "仕様・部数", value: [value.size, value.sides === "single" ? "片面" : value.sides === "double" ? "両面" : "", value.quantity !== undefined ? `${value.quantity}部` : ""].filter(Boolean).join(" / ") || "未設定" },
        { label: "印刷業者", value: displayValue(value.printer) },
        { label: "入稿", value: `${displayValue(value.submissionPlannedDate)}（予定） / ${displayValue(value.submissionDate)}（実績）` },
        { label: "納品", value: `${displayValue(value.deliveryPlannedDate)}（予定） / ${displayValue(value.deliveryDate)}（実績）` },
        { label: "印刷費", value: value.printCost === undefined ? "未設定" : `${value.printCost.toLocaleString()}円` },
      ]} />
    </ManagementSection>;
  }

  function renderEditor() {
    switch (editor.active) {
      case "specifications": {
        const value = editor.draft.specifications ?? {};
        return <div className={styles.formGrid}><Field label="デザイン担当" value={value.designer ?? ""} onChange={(next) => patch("specifications", { designer: next })} /><TextareaField label="表面デザイン" value={value.surfaceDesign ?? ""} onChange={(next) => patch("specifications", { surfaceDesign: next })} /><CheckboxField label="ポスターにチラシ表面デザインを使用" checked={value.posterUsesFlyerFront ?? true} onChange={(checked) => patch("specifications", { posterUsesFlyerFront: checked })} full /></div>;
      }
      case "flyer":
      case "poster":
        return renderPrintEditor(editor.active, editor.draft[editor.active] ?? {});
      case "information": {
        const value = editor.draft.information ?? {};
        return <div className={styles.formGrid}><CheckboxField label="公演情報確定" checked={value.informationFinalized ?? false} onChange={(checked) => patch("information", { informationFinalized: checked })} /><CheckboxField label="協賛・後援等掲載情報確認" checked={value.sponsorInfoReady ?? false} onChange={(checked) => patch("information", { sponsorInfoReady: checked })} /><CheckboxField label="ロゴ素材確認" checked={value.logoMaterialsReady ?? false} onChange={(checked) => patch("information", { logoMaterialsReady: checked })} /><CheckboxField label="校正" checked={value.proofread ?? false} onChange={(checked) => patch("information", { proofread: checked })} /></div>;
      }
      case "distribution": {
        const value = editor.draft.distribution ?? {};
        return <div className={styles.formGrid}><Field label="配布開始日" type="date" value={value.distributionStartDate ?? ""} onChange={(next) => patch("distribution", { distributionStartDate: next })} />{(["venue", "facilities", "inserts", "dm", "performers"] as const).map((key) => <CheckboxField key={key} label={{ venue: "会場", facilities: "施設", inserts: "折込", dm: "DM", performers: "出演者配布" }[key]} checked={value[key] ?? false} onChange={(checked) => patch("distribution", { [key]: checked })} />)}<TextareaField label="その他" value={value.other ?? ""} onChange={(next) => patch("distribution", { other: next })} /><TextareaField label="備考" value={value.note ?? ""} onChange={(next) => patch("distribution", { note: next })} /></div>;
      }
      default:
        return null;
    }
  }

  function renderPrintEditor(block: "flyer" | "poster", value: PrintItemManagement) {
    const label = block === "flyer" ? "チラシ" : "ポスター";
    return <div className={styles.formGrid}>
      <CheckboxField label={`${label}を使用する`} checked={value.enabled ?? false} onChange={(checked) => patch(block, { enabled: checked })} />
      <Field label="サイズ" value={value.size ?? ""} onChange={(next) => patch(block, { size: next })} />
      <label className={styles.field}><span>片面・両面</span><select value={value.sides ?? ""} onChange={(event) => patch(block, { sides: event.target.value as PrintItemManagement["sides"] })}><option value="">未設定</option><option value="single">片面</option><option value="double">両面</option></select></label>
      <Field label="部数" type="number" min={0} value={value.quantity ?? ""} onChange={(next) => patch(block, { quantity: numberOrUndefined(next) })} />
      <Field label="印刷業者" value={value.printer ?? ""} onChange={(next) => patch(block, { printer: next })} />
      <Field label="入稿予定日" type="date" value={value.submissionPlannedDate ?? ""} onChange={(next) => patch(block, { submissionPlannedDate: next })} />
      <Field label="入稿日" type="date" value={value.submissionDate ?? ""} onChange={(next) => patch(block, { submissionDate: next })} />
      <Field label="納品予定日" type="date" value={value.deliveryPlannedDate ?? ""} onChange={(next) => patch(block, { deliveryPlannedDate: next })} />
      <Field label="納品日" type="date" value={value.deliveryDate ?? ""} onChange={(next) => patch(block, { deliveryDate: next })} />
      <Field label="印刷費" type="number" min={0} value={value.printCost ?? ""} onChange={(next) => patch(block, { printCost: numberOrUndefined(next) })} />
    </div>;
  }
}
