"use client";

import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { getProjectRevision } from "@/lib/project-revisions";
import { normalizeDm, type DmManagement } from "@/lib/production-management";
import {
  CheckboxField,
  CheckList,
  DetailList,
  EditorDrawer,
  Field,
  ManagementSection,
  ProductionHeader,
  styles,
  useProductionEditor,
} from "./ProductionCommon";

export function DmManagementClient({
  project,
  management,
}: {
  project: ProjectPerformanceRecord;
  management?: DmManagement;
}) {
  const editor = useProductionEditor(
    project.id,
    "dm",
    normalizeDm(management),
    getProjectRevision(project.revisions, "dm")
  );
  const title = project.data.performanceInfo?.title || project.legacyTitle || "公演タイトル未設定";
  const value = editor.data.preparation ?? {};
  const draft = editor.draft.preparation ?? {};
  const patch = (next: Partial<NonNullable<DmManagement["preparation"]>>) =>
    editor.setDraft((current) => ({
      ...current,
      preparation: { ...current.preparation, ...next },
    }));

  return (
    <main className={styles.page}>
      <ProductionHeader
        projectId={project.id}
        title={title}
        sectionTitle="DM管理"
        eyebrow="PRODUCTION / DIRECT MAIL"
      />
      {editor.message && <p className={styles.successMessage}>{editor.message}</p>}
      <div className={styles.content}>
        <ManagementSection
          id="preparation"
          title="DM準備"
          block="preparation"
          onEdit={editor.open}
        >
          <CheckList items={[
            { label: "案内状", complete: value.invitationReady },
            { label: "チラシ", complete: value.flyerReady },
            { label: value.otherLabel ? `その他：${value.otherLabel}` : "その他", complete: value.otherReady },
            { label: "封筒", complete: value.envelopeReady },
          ]} />
          <DetailList items={[{ label: "投函日", value: value.mailedDate || "未定" }]} />
        </ManagementSection>
      </div>
      {editor.active && (
        <EditorDrawer
          title="DM準備"
          saving={editor.saving}
          error={editor.error}
          conflict={editor.conflict}
          onReload={editor.reloadLatest}
          onClose={editor.close}
          onSave={() => editor.save("DM準備情報")}
        >
          <div className={styles.formGrid}>
            <CheckboxField label="案内状 準備済み" checked={draft.invitationReady ?? false} onChange={(checked) => patch({ invitationReady: checked })} />
            <CheckboxField label="チラシ 準備済み" checked={draft.flyerReady ?? false} onChange={(checked) => patch({ flyerReady: checked })} />
            <CheckboxField label="その他 準備済み" checked={draft.otherReady ?? false} onChange={(checked) => patch({ otherReady: checked })} />
            <Field label="その他内容" value={draft.otherLabel ?? ""} onChange={(otherLabel) => patch({ otherLabel })} />
            <CheckboxField label="封筒 準備済み" checked={draft.envelopeReady ?? false} onChange={(checked) => patch({ envelopeReady: checked })} />
            <Field label="投函日（任意）" type="date" value={draft.mailedDate ?? ""} onChange={(mailedDate) => patch({ mailedDate })} />
          </div>
        </EditorDrawer>
      )}
    </main>
  );
}
