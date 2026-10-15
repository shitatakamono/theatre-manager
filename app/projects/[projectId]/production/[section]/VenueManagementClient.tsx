"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { updateProjectVenueSection } from "@/lib/firestore";
import { useProjectAccess } from "../../ProjectAccess";
import { formatPerformanceDate } from "@/lib/performance";
import { getProjectRevision, isConflictError } from "@/lib/project-revisions";
import type { ReceptionManagement } from "@/lib/production-management";
import {
  normalizeVenueManagement,
  type ApplicationStatus,
  type SubmissionStatus,
  type VenueContract,
  type VenueDocument,
  type VenueLogistics,
  type VenueManagement,
  type VenueManagementSection,
  type VenueManagementSectionMap,
  type VenueMaterials,
  type VenueMeeting,
  type VenueRegisteredPerformance,
  type VenueTechnicalSubmission,
} from "@/lib/venue-management";
import {
  CheckList,
  DetailList,
  Field,
  ProductionHeader,
  ReferencePanel,
  SectionNav,
  TextareaField,
  createId,
  displayValue,
  numberOrUndefined,
  styles,
} from "./ProductionCommon";

type VenueManagementProject = ProjectPerformanceRecord & {
  venueManagement?: VenueManagement;
  receptionManagement?: ReceptionManagement;
};

const labels: Record<VenueManagementSection, string> = {
  contract: "会場利用・契約",
  registeredPerformance: "会場へ登録した公演内容",
  materials: "広報物・提出物",
  meeting: "劇場打ち合わせ",
  documents: "提出書類・申請",
};

const links = [
  { id: "contract", label: "利用・契約" },
  { id: "registered", label: "登録内容" },
  { id: "materials", label: "広報物" },
  { id: "meeting", label: "打ち合わせ" },
  { id: "documents", label: "提出書類" },
];

const applicationLabels: Record<ApplicationStatus, string> = {
  "not-required": "不要",
  "not-applied": "未申請",
  applied: "申請済",
  approved: "承認",
};

const submissionLabels: Record<SubmissionStatus, string> = {
  "not-required": "不要",
  "not-submitted": "未提出",
  submitted: "提出済",
};

const adjustmentLabels = {
  "not-started": "未調整",
  adjusting: "調整中",
  confirmed: "確定",
} as const;

const reductionLabels = {
  "not-applicable": "対象外",
  "not-applied": "未申請",
  applied: "申請済",
  approved: "承認",
  rejected: "不承認",
} as const;

function getContract(data: VenueManagement): VenueContract {
  return {
    useStartAt: data.useStartAt,
    useEndAt: data.useEndAt,
    venueContactName: data.venueContactName,
    venueContact: data.venueContact,
    reservationNumber: data.reservationNumber,
    reductionStatus: data.reductionStatus,
    note: data.note,
  };
}

function getSectionValue<Section extends VenueManagementSection>(
  data: VenueManagement,
  section: Section
): VenueManagementSectionMap[Section] {
  const values: VenueManagementSectionMap = {
    contract: getContract(data),
    registeredPerformance: data.registeredPerformance ?? {},
    materials: data.materials ?? {},
    meeting: data.meeting ?? {},
    documents: data.documents ?? [],
  };
  return values[section];
}

function formatDateTime(value?: string): string {
  if (!value) return "未設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ");
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {(Object.entries(options) as [T, string][]).map(([option, text]) => (
          <option key={option} value={option}>{text}</option>
        ))}
      </select>
    </label>
  );
}

export function VenueManagementClient({ project }: { project: VenueManagementProject }) {
  const { canEdit, actor } = useProjectAccess();
  const initial = normalizeVenueManagement(project.venueManagement);
  const [data, setData] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [active, setActive] = useState<VenueManagementSection | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [revision, setRevision] = useState(() => getProjectRevision(project.revisions, "venue"));
  const [expectedRevision, setExpectedRevision] = useState(revision);
  const [conflict, setConflict] = useState(false);

  const basic = project.data.performanceInfo;
  const venue = project.data.venue;
  const shows = project.data.performances ?? [];
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";
  const timetable = project.receptionManagement?.timetable ?? [];
  const updatedAt = project.performanceInfoUpdatedAt;
  const finalizedAt = data.registeredPerformance?.finalizedAt;
  const changedAfterFinalization = Boolean(
    data.registeredPerformance?.finalized &&
      updatedAt &&
      finalizedAt &&
      new Date(updatedAt).getTime() > new Date(finalizedAt).getTime()
  );

  function open(section: VenueManagementSection) {
    if (!canEdit) return;
    setDraft(structuredClone(data));
    setError("");
    setMessage("");
    setConflict(false);
    setExpectedRevision(revision);
    setActive(section);
  }

  function close() {
    setActive(null);
    setError("");
    setConflict(false);
  }

  async function save() {
    if (!active || !canEdit) return;
    const value = getSectionValue(draft, active);
    setSaving(true);
    setError("");
    setConflict(false);
    try {
      const result = await updateProjectVenueSection(project.id, active, value, {
        actor,
        expectedRevision,
      });
      if (result.changed) {
        setData((current) => active === "contract"
          ? { ...current, ...(value as VenueContract) }
          : { ...current, [active]: value });
        setRevision(result.revision);
        setExpectedRevision(result.revision);
      }
      setMessage(result.changed ? `${labels[active]}を保存しました` : "変更はありません");
      setActive(null);
    } catch (saveError) {
      if (isConflictError(saveError)) setConflict(true);
      setError(saveError instanceof Error ? saveError.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  function reloadLatest() {
    if (confirm("最新の内容を読み込むと、現在入力中の未保存内容は失われます。読み込みますか？")) {
      window.location.reload();
    }
  }

  const patchContract = (patch: Partial<VenueContract>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const patchRegistered = (patch: Partial<VenueRegisteredPerformance>) =>
    setDraft((current) => ({ ...current, registeredPerformance: { ...current.registeredPerformance, ...patch } }));
  const patchMaterials = (patch: Partial<VenueMaterials>) =>
    setDraft((current) => ({ ...current, materials: { ...current.materials, ...patch } }));
  const patchMeeting = (patch: Partial<VenueMeeting>) =>
    setDraft((current) => ({ ...current, meeting: { ...current.meeting, ...patch } }));
  const patchLogistics = (key: "loadIn" | "loadOut", patch: Partial<VenueLogistics>) =>
    patchMeeting({ [key]: { ...draft.meeting?.[key], ...patch } });
  const patchTechnical = (key: "audio" | "lighting" | "video", patch: Partial<VenueTechnicalSubmission>) =>
    patchMeeting({ [key]: { ...draft.meeting?.[key], ...patch } });
  const updateDocument = (index: number, patch: Partial<VenueDocument>) =>
    setDraft((current) => ({ ...current, documents: (current.documents ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }));

  return (
    <main className={styles.page}>
      <ProductionHeader projectId={project.id} title={title} sectionTitle="会場管理" eyebrow="PRODUCTION / VENUE" />
      <ReferencePanel items={[
        { label: "会場名", value: displayValue(venue?.name) },
        { label: "ホール名", value: displayValue(venue?.hall) },
        { label: "所在地", value: displayValue(venue?.address) },
      ]} />
      {message && <p className={styles.successMessage}>{message}</p>}
      <SectionNav links={links} />
      <div className={styles.content}>
        <section className={styles.section} id="contract">
          <header className={styles.sectionHeader}><h2>{labels.contract}</h2>{canEdit && <button onClick={() => open("contract")}>編集</button>}</header>
          <DetailList items={[
            { label: "利用開始", value: formatDateTime(data.useStartAt) },
            { label: "利用終了", value: formatDateTime(data.useEndAt) },
            { label: "会場担当者", value: displayValue(data.venueContactName) },
            { label: "連絡先", value: displayValue(data.venueContact) },
            { label: "予約・申請番号", value: displayValue(data.reservationNumber) },
            { label: "減免申請", value: reductionLabels[data.reductionStatus ?? "not-applicable"] },
          ]} />
          {data.note && <p className={styles.note}>{data.note}</p>}
        </section>

        <section className={styles.section} id="registered">
          <header className={styles.sectionHeader}><h2>{labels.registeredPerformance}</h2>{canEdit && <button onClick={() => open("registeredPerformance")}>編集</button>}</header>
          <div className={styles.referenceDetails}>
            <DetailList items={[
              { label: "公演名称", value: displayValue(basic?.performanceName) },
              { label: "公演日・時間", value: shows.length ? shows.map((show) => `${formatPerformanceDate(show.date)} ${show.startTime || "--:--"}`).join(" / ") : "未設定" },
              { label: "公演情報最終更新", value: formatDateTime(updatedAt) },
              { label: "会場登録内容", value: data.registeredPerformance?.finalized ? "最終決定済" : "未決定" },
              { label: "最終決定日時", value: formatDateTime(finalizedAt) },
            ]} />
          </div>
          {changedAfterFinalization && <p className={styles.warning}>最終決定後に公演情報が変更されています</p>}
          {data.registeredPerformance?.note && <p className={styles.note}>{data.registeredPerformance.note}</p>}
        </section>

        <section className={styles.section} id="materials">
          <header className={styles.sectionHeader}><h2>{labels.materials}</h2>{canEdit && <button onClick={() => open("materials")}>編集</button>}</header>
          <CheckList items={[
            { label: "チラシ提出済", complete: data.materials?.flyerSubmitted },
            { label: "ポスター提出済", complete: data.materials?.posterSubmitted },
            { label: "会場広報掲載依頼済", complete: data.materials?.publicityRequested },
          ]} />
          {data.materials?.note && <p className={styles.note}>{data.materials.note}</p>}
        </section>

        <section className={styles.section} id="meeting">
          <header className={styles.sectionHeader}><h2>{labels.meeting}</h2>{canEdit && <button onClick={() => open("meeting")}>編集</button>}</header>
          <DetailList items={[
            { label: "劇場との日程調整", value: adjustmentLabels[data.meeting?.adjustmentStatus ?? "not-started"] },
            { label: "打ち合わせ予定日", value: displayValue(data.meeting?.plannedDate) },
            { label: "劇団側参加者", value: displayValue(data.meeting?.troupeParticipants) },
            { label: "実施日", value: displayValue(data.meeting?.completedDate) },
            { label: "搬入", value: formatLogistics(data.meeting?.loadIn) },
            { label: "搬出", value: formatLogistics(data.meeting?.loadOut) },
            { label: "物販販売許可", value: applicationLabels[data.meeting?.merchandiseApplication ?? "not-required"] },
            { label: "駐車場", value: applicationLabels[data.meeting?.parkingApplication ?? "not-required"] },
          ]} />
          {(["audio", "lighting", "video"] as const).map((key) => (
            <div className={styles.subForm} key={key}>
              <strong>{{ audio: "音響", lighting: "照明", video: "映像" }[key]}</strong>
              <DetailList items={[
                { label: "機材申請", value: submissionLabels[data.meeting?.[key]?.equipmentApplication ?? "not-submitted"] },
                { label: "仕込み図", value: submissionLabels[data.meeting?.[key]?.setupPlan ?? "not-submitted"] },
              ]} />
            </div>
          ))}
          <div className={styles.timetableStatus}>
            <span>当日タイムスケジュール</span>
            <strong>{timetable.length ? `作成済（${timetable.length}項目）` : "未作成"}</strong>
            <Link href={`/projects/${project.id}/production/reception`}>当日受付で確認</Link>
          </div>
          {data.meeting?.note && <p className={styles.note}>{data.meeting.note}</p>}
        </section>

        <section className={styles.section} id="documents">
          <header className={styles.sectionHeader}><h2>{labels.documents}</h2>{canEdit && <button onClick={() => open("documents")}>編集</button>}</header>
          {(data.documents ?? []).length === 0 ? <p className={styles.empty}>提出書類は登録されていません。</p> : (
            <ul className={styles.documentList}>{(data.documents ?? []).map((document) => (
              <li key={document.id}><span data-submitted={document.submitted}>{document.submitted ? "提出済" : "未提出"}</span><strong>{document.name || "書類名未設定"}</strong><small>期限 {document.deadline || "未設定"}</small>{document.note && <p>{document.note}</p>}</li>
            ))}</ul>
          )}
        </section>
      </div>

      {active && <div className={styles.drawerLayer} role="presentation">
        <button className={styles.backdrop} aria-label="編集を閉じる" onClick={close} />
        <aside className={styles.drawer} aria-label={`${labels[active]}を編集`}>
          <header className={styles.drawerHeader}><div><p>会場管理</p><h2>{labels[active]}を編集</h2></div><button aria-label="閉じる" onClick={close}>×</button></header>
          <div className={styles.drawerBody}>{renderEditor()}</div>
          <footer className={styles.drawerFooter}>{error && (conflict ? <div className={styles.conflictNotice} role="alert"><p>{error}</p><button onClick={reloadLatest}>最新の内容を読み込む</button></div> : <p>{error}</p>)}<button className={styles.cancelButton} onClick={close} disabled={saving}>キャンセル</button><button className={styles.saveButton} onClick={save} disabled={saving}>{saving ? "保存中…" : "保存"}</button></footer>
        </aside>
      </div>}
    </main>
  );

  function renderEditor() {
    switch (active) {
      case "contract":
        return <div className={styles.formGrid}>
          <Field label="利用開始日時" type="datetime-local" value={draft.useStartAt ?? ""} onChange={(value) => patchContract({ useStartAt: value })} />
          <Field label="利用終了日時" type="datetime-local" value={draft.useEndAt ?? ""} onChange={(value) => patchContract({ useEndAt: value })} />
          <Field label="会場担当者" value={draft.venueContactName ?? ""} onChange={(value) => patchContract({ venueContactName: value })} />
          <Field label="連絡先" type="tel" value={draft.venueContact ?? ""} onChange={(value) => patchContract({ venueContact: value })} />
          <Field label="予約・申請番号" value={draft.reservationNumber ?? ""} onChange={(value) => patchContract({ reservationNumber: value })} />
          <SelectField label="減免申請状況" value={draft.reductionStatus ?? "not-applicable"} options={reductionLabels} onChange={(value) => patchContract({ reductionStatus: value })} />
          <TextareaField label="備考" value={draft.note ?? ""} onChange={(value) => patchContract({ note: value })} />
        </div>;
      case "registeredPerformance":
        return <div className={styles.formGrid}>
          <label className={`${styles.checkboxField} ${styles.fullField}`}><input type="checkbox" checked={draft.registeredPerformance?.finalized ?? false} onChange={(event) => patchRegistered({ finalized: event.target.checked, finalizedAt: event.target.checked ? new Date().toISOString() : undefined })} /><span>会場登録内容 最終決定済</span></label>
          <TextareaField label="備考" value={draft.registeredPerformance?.note ?? ""} onChange={(value) => patchRegistered({ note: value })} />
        </div>;
      case "materials":
        return <div className={styles.formGrid}>
          <CheckBox label="チラシ提出済" checked={draft.materials?.flyerSubmitted} onChange={(checked) => patchMaterials({ flyerSubmitted: checked })} />
          <CheckBox label="ポスター提出済" checked={draft.materials?.posterSubmitted} onChange={(checked) => patchMaterials({ posterSubmitted: checked })} />
          <CheckBox label="会場広報掲載依頼済" checked={draft.materials?.publicityRequested} onChange={(checked) => patchMaterials({ publicityRequested: checked })} />
          <TextareaField label="備考" value={draft.materials?.note ?? ""} onChange={(value) => patchMaterials({ note: value })} />
        </div>;
      case "meeting":
        return <div className={styles.formGrid}>
          <SelectField label="劇場との日程調整" value={draft.meeting?.adjustmentStatus ?? "not-started"} options={adjustmentLabels} onChange={(value) => patchMeeting({ adjustmentStatus: value })} />
          <Field label="打ち合わせ予定日" type="date" value={draft.meeting?.plannedDate ?? ""} onChange={(value) => patchMeeting({ plannedDate: value })} />
          <Field label="劇団側参加者" value={draft.meeting?.troupeParticipants ?? ""} onChange={(value) => patchMeeting({ troupeParticipants: value })} />
          <Field label="実施日" type="date" value={draft.meeting?.completedDate ?? ""} onChange={(value) => patchMeeting({ completedDate: value })} />
          <LogisticsFields title="搬入" value={draft.meeting?.loadIn} onChange={(patch) => patchLogistics("loadIn", patch)} />
          <LogisticsFields title="搬出" value={draft.meeting?.loadOut} onChange={(patch) => patchLogistics("loadOut", patch)} />
          {(["merchandiseApplication", "parkingApplication"] as const).map((key) => <SelectField key={key} label={{ merchandiseApplication: "物販販売許可申請", parkingApplication: "駐車場申請" }[key]} value={draft.meeting?.[key] ?? "not-required"} options={applicationLabels} onChange={(value) => patchMeeting({ [key]: value })} />)}
          {(["audio", "lighting", "video"] as const).map((key) => <fieldset className={`${styles.formGrid} ${styles.fullField} ${styles.subForm}`} key={key}><legend>{{ audio: "音響", lighting: "照明", video: "映像" }[key]}</legend><SelectField label="機材申請" value={draft.meeting?.[key]?.equipmentApplication ?? "not-submitted"} options={submissionLabels} onChange={(value) => patchTechnical(key, { equipmentApplication: value })} /><SelectField label="仕込み図" value={draft.meeting?.[key]?.setupPlan ?? "not-submitted"} options={submissionLabels} onChange={(value) => patchTechnical(key, { setupPlan: value })} /></fieldset>)}
          <TextareaField label="備考" value={draft.meeting?.note ?? ""} onChange={(value) => patchMeeting({ note: value })} />
        </div>;
      case "documents":
        return <div className={styles.repeater}>{(draft.documents ?? []).map((document, index) => <div className={styles.repeaterItem} key={document.id}><div className={styles.repeaterHeader}><strong>提出書類 {index + 1}</strong><button onClick={() => setDraft((current) => ({ ...current, documents: (current.documents ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>削除</button></div><div className={styles.formGrid}><Field label="書類名" value={document.name} onChange={(value) => updateDocument(index, { name: value })} /><Field label="期限" type="date" value={document.deadline ?? ""} onChange={(value) => updateDocument(index, { deadline: value })} /><CheckBox label="提出済" checked={document.submitted} onChange={(checked) => updateDocument(index, { submitted: checked })} /><TextareaField label="備考" value={document.note ?? ""} onChange={(value) => updateDocument(index, { note: value })} /></div></div>)}<button className={styles.addButton} onClick={() => setDraft((current) => ({ ...current, documents: [...(current.documents ?? []), { id: createId(), name: "", submitted: false }] }))}>＋提出書類を追加</button></div>;
      default:
        return null;
    }
  }
}

function CheckBox({ label, checked, onChange }: { label: string; checked?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={styles.checkboxField}><input type="checkbox" checked={checked ?? false} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function LogisticsFields({ title, value, onChange }: { title: string; value?: VenueLogistics; onChange: (patch: Partial<VenueLogistics>) => void }) {
  return <fieldset className={`${styles.formGrid} ${styles.fullField} ${styles.subForm}`}><legend>{title}</legend><Field label="日時" type="datetime-local" value={value?.dateTime ?? ""} onChange={(next) => onChange({ dateTime: next })} /><Field label="車種" value={value?.vehicleType ?? ""} onChange={(next) => onChange({ vehicleType: next })} /><Field label="台数" type="number" min={0} value={value?.vehicleCount ?? ""} onChange={(next) => onChange({ vehicleCount: numberOrUndefined(next) })} /><TextareaField label="備考" value={value?.note ?? ""} onChange={(next) => onChange({ note: next })} /></fieldset>;
}

function formatLogistics(value?: VenueLogistics): string {
  if (!value || (!value.dateTime && !value.vehicleType && value.vehicleCount === undefined && !value.note)) return "未設定";
  return [formatDateTime(value.dateTime), value.vehicleType, value.vehicleCount === undefined ? "" : `${value.vehicleCount}台`, value.note].filter(Boolean).join(" / ");
}
