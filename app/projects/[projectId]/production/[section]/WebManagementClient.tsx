"use client";

import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { normalizeWeb, type WebManagement } from "@/lib/production-management";
import { CheckboxField, CheckList, DetailList, EditorDrawer, Field, ManagementSection, ProductionHeader, ReferencePanel, SectionNav, TextareaField, displayValue, styles, useProductionEditor } from "./ProductionCommon";

type Block = keyof WebManagement & string;
const labels: Record<Block, string> = { channels: "使用媒体", page: "公演ページ", announcements: "告知タイミング", assets: "使用素材", consistency: "公演情報との整合確認", postShow: "終演後対応" };
const links = Object.entries(labels).map(([id, label]) => ({ id, label }));

export function WebManagementClient({ project, management }: { project: ProjectPerformanceRecord; management?: WebManagement }) {
  const editor = useProductionEditor(project.id, "web", normalizeWeb(management));
  const basic = project.data.performanceInfo;
  const contact = project.data.contact;
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";
  const patch = <K extends Block>(block: K, value: Partial<NonNullable<WebManagement[K]>>) => editor.setDraft((current) => ({ ...current, [block]: { ...(current[block] as object), ...value } }));
  const channelLabels = { website: "公式サイト", x: "X", instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" } as const;
  const assetLabels = { mainVisual: "メインビジュアル", flyerImage: "チラシ画像", castPhotos: "出演者写真", map: "地図", qr: "QR", promoVideo: "告知動画", sponsorLogos: "協賛ロゴ" } as const;

  return <main className={styles.page}>
    <ProductionHeader projectId={project.id} title={title} sectionTitle="Web・SNS" eyebrow="PRODUCTION / WEB & SNS" />
    <ReferencePanel items={[{ label: "公演名称", value: displayValue(basic?.performanceName) }, { label: "公演タイトル", value: title }, { label: "公式サイト", value: displayValue(contact?.website) }, { label: "公式SNS", value: [contact?.x, contact?.instagram].filter(Boolean).join(" / ") || "未設定" }]} />
    {editor.message && <p className={styles.successMessage}>{editor.message}</p>}<SectionNav links={links} />
    <div className={styles.content}>
      <ManagementSection id="channels" title={labels.channels} block="channels" onEdit={editor.open}><CheckList items={Object.entries(channelLabels).map(([key, label]) => ({ label, complete: editor.data.channels?.[key as keyof typeof channelLabels] as boolean }))} />{editor.data.channels?.other && <p className={styles.note}>{editor.data.channels.other}</p>}</ManagementSection>
      <ManagementSection id="page" title={labels.page} block="page" onEdit={editor.open}><DetailList items={[{ label: "公演ページURL", value: displayValue(editor.data.page?.performancePageUrl) }, { label: "公開予定日", value: displayValue(editor.data.page?.publishPlannedDate) }, { label: "公開日", value: displayValue(editor.data.page?.publishDate) }, { label: "公開状態", value: editor.data.page?.published ? "公開済" : "未公開" }]} /><CheckList items={[{ label: "チケットリンク", complete: editor.data.page?.ticketLinkPublished }, { label: "アクセス", complete: editor.data.page?.accessPublished }, { label: "出演者", complete: editor.data.page?.castPublished }, { label: "掲載情報", complete: editor.data.page?.creditsPublished }]} /></ManagementSection>
      <ManagementSection id="announcements" title={labels.announcements} block="announcements" onEdit={editor.open}><DetailList items={[{ label: "告知開始日", value: displayValue(editor.data.announcements?.announcementStartDate) }]} /><CheckList items={[{ label: "販売開始告知", complete: editor.data.announcements?.ticketSalesAnnouncement }, { label: "本番前リマインド", complete: editor.data.announcements?.preShowReminder }]} /></ManagementSection>
      <ManagementSection id="assets" title={labels.assets} block="assets" onEdit={editor.open}><CheckList items={Object.entries(assetLabels).map(([key, label]) => ({ label, complete: editor.data.assets?.[key as keyof typeof assetLabels] }))} /></ManagementSection>
      <ManagementSection id="consistency" title={labels.consistency} block="consistency" onEdit={editor.open}><DetailList items={[{ label: "公演情報確認日", value: displayValue(editor.data.consistency?.performanceInfoCheckedAt) }]} />{editor.data.consistency?.note && <p className={styles.note}>{editor.data.consistency.note}</p>}</ManagementSection>
      <ManagementSection id="postShow" title={labels.postShow} block="postShow" onEdit={editor.open}><CheckList items={[{ label: "終演報告", complete: editor.data.postShow?.postShowReport }, { label: "チケットリンク終了", complete: editor.data.postShow?.ticketLinkClosed }, { label: "公演ページ更新", complete: editor.data.postShow?.performancePageUpdated }]} />{editor.data.postShow?.note && <p className={styles.note}>{editor.data.postShow.note}</p>}</ManagementSection>
    </div>
    {editor.active && <EditorDrawer title={labels[editor.active]} saving={editor.saving} error={editor.error} onClose={editor.close} onSave={() => editor.save(labels[editor.active!])}>{renderEditor()}</EditorDrawer>}
  </main>;

  function renderEditor() {
    const draft = editor.draft;
    switch (editor.active) {
      case "channels": { const value = draft.channels ?? {}; return <div className={styles.formGrid}>{Object.entries(channelLabels).map(([key, label]) => <CheckboxField key={key} label={label} checked={(value[key as keyof typeof channelLabels] as boolean) ?? false} onChange={(checked) => patch("channels", { [key]: checked })} />)}<TextareaField label="その他" value={value.other ?? ""} onChange={(v) => patch("channels", { other: v })} /></div>; }
      case "page": { const value = draft.page ?? {}; return <div className={styles.formGrid}><Field label="公演ページURL" type="url" value={value.performancePageUrl ?? ""} onChange={(v) => patch("page", { performancePageUrl: v })} /><Field label="公開予定日" type="date" value={value.publishPlannedDate ?? ""} onChange={(v) => patch("page", { publishPlannedDate: v })} /><Field label="公開日" type="date" value={value.publishDate ?? ""} onChange={(v) => patch("page", { publishDate: v })} /><CheckboxField label="公開済" checked={value.published ?? false} onChange={(checked) => patch("page", { published: checked })} />{(["ticketLinkPublished", "accessPublished", "castPublished", "creditsPublished"] as const).map((key) => <CheckboxField key={key} label={{ ticketLinkPublished: "チケットリンク掲載", accessPublished: "アクセス掲載", castPublished: "出演者掲載", creditsPublished: "掲載情報掲載" }[key]} checked={value[key] ?? false} onChange={(checked) => patch("page", { [key]: checked })} />)}</div>; }
      case "announcements": { const value = draft.announcements ?? {}; return <div className={styles.formGrid}><Field label="告知開始日" type="date" value={value.announcementStartDate ?? ""} onChange={(v) => patch("announcements", { announcementStartDate: v })} /><CheckboxField label="販売開始告知済" checked={value.ticketSalesAnnouncement ?? false} onChange={(checked) => patch("announcements", { ticketSalesAnnouncement: checked })} /><CheckboxField label="本番前リマインド済" checked={value.preShowReminder ?? false} onChange={(checked) => patch("announcements", { preShowReminder: checked })} /></div>; }
      case "assets": { const value = draft.assets ?? {}; return <div className={styles.formGrid}>{Object.entries(assetLabels).map(([key, label]) => <CheckboxField key={key} label={label} checked={value[key as keyof typeof assetLabels] ?? false} onChange={(checked) => patch("assets", { [key]: checked })} />)}</div>; }
      case "consistency": { const value = draft.consistency ?? {}; return <div className={styles.formGrid}><Field label="公演情報確認日" type="date" value={value.performanceInfoCheckedAt ?? ""} onChange={(v) => patch("consistency", { performanceInfoCheckedAt: v })} /><TextareaField label="備考" value={value.note ?? ""} onChange={(v) => patch("consistency", { note: v })} /></div>; }
      case "postShow": { const value = draft.postShow ?? {}; return <div className={styles.formGrid}><CheckboxField label="終演報告済" checked={value.postShowReport ?? false} onChange={(checked) => patch("postShow", { postShowReport: checked })} /><CheckboxField label="チケットリンク終了確認" checked={value.ticketLinkClosed ?? false} onChange={(checked) => patch("postShow", { ticketLinkClosed: checked })} /><CheckboxField label="公演ページ更新済" checked={value.performancePageUpdated ?? false} onChange={(checked) => patch("postShow", { performancePageUpdated: checked })} /><TextareaField label="備考" value={value.note ?? ""} onChange={(v) => patch("postShow", { note: v })} /></div>; }
      default: return null;
    }
  }
}
