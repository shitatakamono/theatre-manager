"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProjectPerformanceRecord } from "@/lib/firestore";
import {
  formatPerformanceDate,
  type ContactInfo,
  type PerformanceInfo,
  type TicketInfo,
  type VenueInfo,
} from "@/lib/performance";
import {
  normalizeVenueManagement,
  type VenueContract,
  type VenueDocument,
  type VenueManagement,
  type VenueManagementSection,
  type VenueManagementSectionMap,
  type VenueMaterials,
  type VenueMeeting,
  type VenueRegisteredPerformance,
} from "@/lib/venue-management";
import styles from "./venue-management.module.css";

type VenueManagementProject = ProjectPerformanceRecord & {
  venueManagement?: VenueManagement;
};

type FieldProps = {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date" | "time" | "tel";
  min?: number;
};

type TextareaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
};

type ManagementSectionProps = {
  id: string;
  title: string;
  section: VenueManagementSection;
  onEdit: (section: VenueManagementSection) => void;
  children: React.ReactNode;
};

const editorLabels: Record<VenueManagementSection, string> = {
  contract: "会場利用・契約",
  registeredPerformance: "会場へ登録した公演内容",
  materials: "広報物・提出物",
  meeting: "劇場打ち合わせ",
  documents: "提出書類・申請",
};

const sectionLinks: { id: string; label: string }[] = [
  { id: "contract", label: "利用・契約" },
  { id: "registered", label: "登録内容" },
  { id: "materials", label: "広報物" },
  { id: "meeting", label: "打ち合わせ" },
  { id: "documents", label: "提出書類" },
];

function Field({ label, value, onChange, type = "text", min }: FieldProps) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type={type}
        min={min}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  onChange,
  rows = 3,
}: TextareaProps) {
  return (
    <label className={`${styles.field} ${styles.fullField}`}>
      <span>{label}</span>
      <textarea
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ManagementSection({
  id,
  title,
  section,
  onEdit,
  children,
}: ManagementSectionProps) {
  return (
    <section className={styles.section} id={id}>
      <header className={styles.sectionHeader}>
        <h2>{title}</h2>
        <button onClick={() => onEdit(section)}>編集</button>
      </header>
      {children}
    </section>
  );
}

function displayValue(value?: string | number): string {
  return value === undefined || value === "" ? "未設定" : String(value);
}

function numberOrUndefined(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

function createId(): string {
  return crypto.randomUUID();
}

function getContract(data: VenueManagement): VenueContract {
  return {
    useStartDate: data.useStartDate,
    useEndDate: data.useEndDate,
    useStartTime: data.useStartTime,
    useEndTime: data.useEndTime,
    applicationDate: data.applicationDate,
    venueFee: data.venueFee,
    paymentDeadline: data.paymentDeadline,
    paymentPaid: data.paymentPaid,
    venueContactName: data.venueContactName,
    venueContact: data.venueContact,
    reservationNumber: data.reservationNumber,
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

function formatTickets(tickets?: TicketInfo): string {
  if (!tickets) return "未設定";
  if (!tickets.isPaid) return "無料";

  const prices = [
    ["前売一般", tickets.advanceGeneral],
    ["前売学生", tickets.advanceStudent],
    ["当日一般", tickets.doorGeneral],
    ["当日学生", tickets.doorStudent],
  ]
    .filter((item): item is [string, number] => typeof item[1] === "number")
    .map(([label, price]) => `${label} ${price.toLocaleString()}円`);

  return prices.length > 0 ? prices.join(" / ") : "有料（料金未設定）";
}

export function VenueManagementClient({
  project,
}: {
  project: VenueManagementProject;
}) {
  const [data, setData] = useState<VenueManagement>(() =>
    normalizeVenueManagement(project.venueManagement)
  );
  const [draft, setDraft] = useState<VenueManagement>(() =>
    normalizeVenueManagement(project.venueManagement)
  );
  const [activeEditor, setActiveEditor] =
    useState<VenueManagementSection | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const basic = project.data.performanceInfo as PerformanceInfo | undefined;
  const venue = project.data.venue as VenueInfo | undefined;
  const shows = project.data.performances ?? [];
  const tickets = project.data.tickets;
  const contact = project.data.contact as ContactInfo | undefined;
  const title = basic?.title || project.legacyTitle || "公演タイトル未設定";

  function openEditor(section: VenueManagementSection) {
    setDraft(structuredClone(data));
    setSaveError("");
    setSavedMessage("");
    setActiveEditor(section);
  }

  async function saveSection() {
    if (!activeEditor) return;

    const value = getSectionValue(draft, activeEditor);
    setSaving(true);
    setSaveError("");

    try {
      const response = await fetch(
        `/api/projects/${project.id}/production/venue`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ section: activeEditor, value }),
        }
      );

      if (!response.ok) {
        const result = (await response.json()) as { error?: string };
        throw new Error(result.error || "保存できませんでした");
      }

      setData((current) => {
        if (activeEditor === "contract") {
          return { ...current, ...(value as VenueContract) };
        }
        return { ...current, [activeEditor]: value };
      });
      setSavedMessage(`${editorLabels[activeEditor]}を保存しました`);
      setActiveEditor(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "保存できませんでした"
      );
    } finally {
      setSaving(false);
    }
  }

  function patchContract(patch: Partial<VenueContract>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function patchRegistered(patch: Partial<VenueRegisteredPerformance>) {
    setDraft((current) => ({
      ...current,
      registeredPerformance: {
        ...current.registeredPerformance,
        ...patch,
      },
    }));
  }

  function patchMaterials(patch: Partial<VenueMaterials>) {
    setDraft((current) => ({
      ...current,
      materials: { ...current.materials, ...patch },
    }));
  }

  function patchMeeting(patch: Partial<VenueMeeting>) {
    setDraft((current) => ({
      ...current,
      meeting: { ...current.meeting, ...patch },
    }));
  }

  function updateDocument(index: number, patch: Partial<VenueDocument>) {
    setDraft((current) => ({
      ...current,
      documents: (current.documents ?? []).map((document, documentIndex) =>
        documentIndex === index ? { ...document, ...patch } : document
      ),
    }));
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <Link className={styles.backLink} href={`/projects/${project.id}`}>
            ← 制作ロードマップへ戻る
          </Link>
          <p className={styles.eyebrow}>PRODUCTION / VENUE</p>
          <h1>会場管理</h1>
          <p className={styles.projectTitle}>{title}</p>
        </div>
        <Link className={styles.infoLink} href={`/projects/${project.id}/info`}>
          公演情報を見る
        </Link>
      </header>

      <section className={styles.venueReference}>
        <p>公演情報から参照</p>
        <dl>
          <div>
            <dt>会場名</dt>
            <dd>{displayValue(venue?.name)}</dd>
          </div>
          <div>
            <dt>ホール名</dt>
            <dd>{displayValue(venue?.hall)}</dd>
          </div>
          <div>
            <dt>所在地</dt>
            <dd>{displayValue(venue?.address)}</dd>
          </div>
        </dl>
      </section>

      {savedMessage && <p className={styles.successMessage}>{savedMessage}</p>}

      <nav className={styles.sectionNav} aria-label="会場管理のセクション">
        {sectionLinks.map((link) => (
          <a key={link.id} href={`#${link.id}`}>
            {link.label}
          </a>
        ))}
      </nav>

      <div className={styles.content}>
        <ManagementSection
          id="contract"
          title="会場利用・契約"
          section="contract"
          onEdit={openEditor}
        >
          <dl className={styles.detailList}>
            <div><dt>利用期間</dt><dd>{data.useStartDate || data.useEndDate ? `${displayValue(data.useStartDate)} 〜 ${displayValue(data.useEndDate)}` : "未設定"}</dd></div>
            <div><dt>利用時間</dt><dd>{data.useStartTime || data.useEndTime ? `${displayValue(data.useStartTime)} 〜 ${displayValue(data.useEndTime)}` : "未設定"}</dd></div>
            <div><dt>申込日</dt><dd>{displayValue(data.applicationDate)}</dd></div>
            <div><dt>会場利用料</dt><dd>{data.venueFee === undefined ? "未設定" : `${data.venueFee.toLocaleString()}円`}</dd></div>
            <div><dt>支払期限</dt><dd>{displayValue(data.paymentDeadline)}</dd></div>
            <div><dt>支払状況</dt><dd>{data.paymentPaid ? "支払済" : "未払い"}</dd></div>
            <div><dt>会場担当者</dt><dd>{displayValue(data.venueContactName)}</dd></div>
            <div><dt>連絡先</dt><dd>{displayValue(data.venueContact)}</dd></div>
            <div><dt>予約・申請番号</dt><dd>{displayValue(data.reservationNumber)}</dd></div>
          </dl>
          {data.note && <p className={styles.note}>{data.note}</p>}
        </ManagementSection>

        <ManagementSection
          id="registered"
          title="会場へ登録した公演内容"
          section="registeredPerformance"
          onEdit={openEditor}
        >
          <p className={styles.description}>
            公演情報と会場へ登録した内容に変更がないか確認するための項目です。
          </p>
          <dl className={`${styles.detailList} ${styles.referenceDetails}`}>
            <div><dt>公演名称</dt><dd>{displayValue(basic?.performanceName)}</dd></div>
            <div><dt>公演日・時間</dt><dd>{shows.length === 0 ? "未設定" : shows.map((show) => `${formatPerformanceDate(show.date)} 開場 ${show.openTime || "--:--"} / 開演 ${show.startTime || "--:--"}`).join("、")}</dd></div>
            <div><dt>上演時間</dt><dd>{basic?.durationMinutes ? `${basic.durationMinutes}分` : "未設定"}</dd></div>
            <div><dt>チケット料金</dt><dd>{formatTickets(tickets)}</dd></div>
            <div><dt>主催</dt><dd>{displayValue(basic?.organizer)}</dd></div>
            <div><dt>問い合わせ</dt><dd>{[contact?.name, contact?.phone, contact?.email].filter(Boolean).join(" / ") || "未設定"}</dd></div>
          </dl>
          <dl className={styles.statusList}>
            <div><dt>最終確認日</dt><dd>{displayValue(data.registeredPerformance?.checkedAt)}</dd></div>
            <div><dt>修正確認</dt><dd>{data.registeredPerformance?.needsUpdate ? "確認が必要" : "確認不要"}</dd></div>
          </dl>
          {data.registeredPerformance?.note && <p className={styles.note}>{data.registeredPerformance.note}</p>}
        </ManagementSection>

        <ManagementSection
          id="materials"
          title="広報物・提出物"
          section="materials"
          onEdit={openEditor}
        >
          <p className={styles.description}>制作作業ではなく、会場への提出状況のみを管理します。</p>
          <ul className={styles.checkList}>
            <li data-complete={data.materials?.flyerSubmitted}>{data.materials?.flyerSubmitted ? "✓" : "–"} チラシ提出済</li>
            <li data-complete={data.materials?.posterSubmitted}>{data.materials?.posterSubmitted ? "✓" : "–"} ポスター提出済</li>
            <li data-complete={data.materials?.publicityRequested}>{data.materials?.publicityRequested ? "✓" : "–"} 会場広報掲載依頼済</li>
          </ul>
          {data.materials?.note && <p className={styles.note}>{data.materials.note}</p>}
        </ManagementSection>

        <ManagementSection
          id="meeting"
          title="劇場打ち合わせ"
          section="meeting"
          onEdit={openEditor}
        >
          <dl className={styles.detailList}>
            <div><dt>打ち合わせ予定日</dt><dd>{displayValue(data.meeting?.plannedDate)}</dd></div>
            <div><dt>実施日</dt><dd>{displayValue(data.meeting?.completedDate)}</dd></div>
            <div><dt>劇団側参加者</dt><dd>{displayValue(data.meeting?.troupeParticipants)}</dd></div>
            <div><dt>搬入・搬出</dt><dd>{displayValue(data.meeting?.loadInOut)}</dd></div>
            <div><dt>客席数</dt><dd>{displayValue(data.meeting?.audienceCapacity)}</dd></div>
            <div><dt>受付場所</dt><dd>{displayValue(data.meeting?.receptionLocation)}</dd></div>
            <div><dt>当日券</dt><dd>{displayValue(data.meeting?.doorTicket)}</dd></div>
            <div><dt>楽屋・控室</dt><dd>{displayValue(data.meeting?.dressingRoom)}</dd></div>
            <div><dt>物販場所</dt><dd>{displayValue(data.meeting?.merchLocation)}</dd></div>
            <div><dt>飲食</dt><dd>{displayValue(data.meeting?.foodDrink)}</dd></div>
            <div><dt>駐車場</dt><dd>{displayValue(data.meeting?.parking)}</dd></div>
            <div><dt>ゴミ</dt><dd>{displayValue(data.meeting?.garbage)}</dd></div>
            <div><dt>原状復帰</dt><dd>{displayValue(data.meeting?.restoration)}</dd></div>
            <div><dt>禁止事項</dt><dd>{displayValue(data.meeting?.prohibitedItems)}</dd></div>
            <div><dt>技術概要</dt><dd>{displayValue(data.meeting?.technicalOverview)}</dd></div>
          </dl>
          <div className={styles.timetableStatus}>
            <span>当日タイムスケジュール</span>
            <strong>{data.meeting?.timetableConfirmed ? "確認済" : "未作成"}</strong>
            <small>当日受付セクションで作成予定</small>
          </div>
          {data.meeting?.note && <p className={styles.note}>{data.meeting.note}</p>}
        </ManagementSection>

        <ManagementSection
          id="documents"
          title="提出書類・申請"
          section="documents"
          onEdit={openEditor}
        >
          {(data.documents ?? []).length === 0 ? (
            <p className={styles.empty}>提出書類は登録されていません。</p>
          ) : (
            <ul className={styles.documentList}>
              {(data.documents ?? []).map((document) => (
                <li key={document.id}>
                  <span data-submitted={document.submitted}>{document.submitted ? "提出済" : "未提出"}</span>
                  <strong>{document.name || "書類名未設定"}</strong>
                  <small>期限 {document.deadline || "未設定"}</small>
                  {document.note && <p>{document.note}</p>}
                </li>
              ))}
            </ul>
          )}
        </ManagementSection>
      </div>

      {activeEditor && (
        <div className={styles.drawerLayer} role="presentation">
          <button
            className={styles.backdrop}
            aria-label="編集を閉じる"
            onClick={() => setActiveEditor(null)}
          />
          <aside className={styles.drawer} aria-label={`${editorLabels[activeEditor]}を編集`}>
            <header className={styles.drawerHeader}>
              <div><p>会場管理</p><h2>{editorLabels[activeEditor]}を編集</h2></div>
              <button aria-label="閉じる" onClick={() => setActiveEditor(null)}>×</button>
            </header>
            <div className={styles.drawerBody}>{renderEditor()}</div>
            <footer className={styles.drawerFooter}>
              {saveError && <p>{saveError}</p>}
              <button className={styles.cancelButton} onClick={() => setActiveEditor(null)} disabled={saving}>キャンセル</button>
              <button className={styles.saveButton} onClick={saveSection} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
            </footer>
          </aside>
        </div>
      )}
    </main>
  );

  function renderEditor() {
    switch (activeEditor) {
      case "contract":
        return (
          <div className={styles.formGrid}>
            <Field label="利用開始日" type="date" value={draft.useStartDate ?? ""} onChange={(value) => patchContract({ useStartDate: value })} />
            <Field label="利用終了日" type="date" value={draft.useEndDate ?? ""} onChange={(value) => patchContract({ useEndDate: value })} />
            <Field label="利用開始時間" type="time" value={draft.useStartTime ?? ""} onChange={(value) => patchContract({ useStartTime: value })} />
            <Field label="利用終了時間" type="time" value={draft.useEndTime ?? ""} onChange={(value) => patchContract({ useEndTime: value })} />
            <Field label="申込日" type="date" value={draft.applicationDate ?? ""} onChange={(value) => patchContract({ applicationDate: value })} />
            <Field label="会場利用料" type="number" min={0} value={draft.venueFee ?? ""} onChange={(value) => patchContract({ venueFee: numberOrUndefined(value) })} />
            <Field label="支払期限" type="date" value={draft.paymentDeadline ?? ""} onChange={(value) => patchContract({ paymentDeadline: value })} />
            <label className={styles.checkboxField}><input type="checkbox" checked={draft.paymentPaid ?? false} onChange={(event) => patchContract({ paymentPaid: event.target.checked })} /><span>支払済</span></label>
            <Field label="会場担当者" value={draft.venueContactName ?? ""} onChange={(value) => patchContract({ venueContactName: value })} />
            <Field label="連絡先" type="tel" value={draft.venueContact ?? ""} onChange={(value) => patchContract({ venueContact: value })} />
            <Field label="予約・申請番号" value={draft.reservationNumber ?? ""} onChange={(value) => patchContract({ reservationNumber: value })} />
            <TextareaField label="備考" value={draft.note ?? ""} onChange={(value) => patchContract({ note: value })} />
          </div>
        );
      case "registeredPerformance":
        return (
          <div className={styles.formGrid}>
            <Field label="最終確認日" type="date" value={draft.registeredPerformance?.checkedAt ?? ""} onChange={(value) => patchRegistered({ checkedAt: value })} />
            <label className={styles.checkboxField}><input type="checkbox" checked={draft.registeredPerformance?.needsUpdate ?? false} onChange={(event) => patchRegistered({ needsUpdate: event.target.checked })} /><span>修正確認が必要</span></label>
            <TextareaField label="備考" value={draft.registeredPerformance?.note ?? ""} onChange={(value) => patchRegistered({ note: value })} />
          </div>
        );
      case "materials":
        return (
          <div className={styles.formGrid}>
            <label className={styles.checkboxField}><input type="checkbox" checked={draft.materials?.flyerSubmitted ?? false} onChange={(event) => patchMaterials({ flyerSubmitted: event.target.checked })} /><span>チラシ提出済</span></label>
            <label className={styles.checkboxField}><input type="checkbox" checked={draft.materials?.posterSubmitted ?? false} onChange={(event) => patchMaterials({ posterSubmitted: event.target.checked })} /><span>ポスター提出済</span></label>
            <label className={`${styles.checkboxField} ${styles.fullField}`}><input type="checkbox" checked={draft.materials?.publicityRequested ?? false} onChange={(event) => patchMaterials({ publicityRequested: event.target.checked })} /><span>会場広報掲載依頼済</span></label>
            <TextareaField label="備考" value={draft.materials?.note ?? ""} onChange={(value) => patchMaterials({ note: value })} />
          </div>
        );
      case "meeting":
        return (
          <div className={styles.formGrid}>
            <Field label="打ち合わせ予定日" type="date" value={draft.meeting?.plannedDate ?? ""} onChange={(value) => patchMeeting({ plannedDate: value })} />
            <Field label="実施日" type="date" value={draft.meeting?.completedDate ?? ""} onChange={(value) => patchMeeting({ completedDate: value })} />
            <Field label="劇団側参加者" value={draft.meeting?.troupeParticipants ?? ""} onChange={(value) => patchMeeting({ troupeParticipants: value })} />
            <Field label="客席数" value={draft.meeting?.audienceCapacity ?? ""} onChange={(value) => patchMeeting({ audienceCapacity: value })} />
            <TextareaField label="搬入・搬出" value={draft.meeting?.loadInOut ?? ""} onChange={(value) => patchMeeting({ loadInOut: value })} />
            <TextareaField label="受付場所" value={draft.meeting?.receptionLocation ?? ""} onChange={(value) => patchMeeting({ receptionLocation: value })} />
            <TextareaField label="当日券" value={draft.meeting?.doorTicket ?? ""} onChange={(value) => patchMeeting({ doorTicket: value })} />
            <TextareaField label="楽屋・控室" value={draft.meeting?.dressingRoom ?? ""} onChange={(value) => patchMeeting({ dressingRoom: value })} />
            <TextareaField label="物販場所" value={draft.meeting?.merchLocation ?? ""} onChange={(value) => patchMeeting({ merchLocation: value })} />
            <TextareaField label="飲食" value={draft.meeting?.foodDrink ?? ""} onChange={(value) => patchMeeting({ foodDrink: value })} />
            <TextareaField label="駐車場" value={draft.meeting?.parking ?? ""} onChange={(value) => patchMeeting({ parking: value })} />
            <TextareaField label="ゴミ" value={draft.meeting?.garbage ?? ""} onChange={(value) => patchMeeting({ garbage: value })} />
            <TextareaField label="原状復帰" value={draft.meeting?.restoration ?? ""} onChange={(value) => patchMeeting({ restoration: value })} />
            <TextareaField label="禁止事項" value={draft.meeting?.prohibitedItems ?? ""} onChange={(value) => patchMeeting({ prohibitedItems: value })} />
            <TextareaField label="技術概要" value={draft.meeting?.technicalOverview ?? ""} onChange={(value) => patchMeeting({ technicalOverview: value })} />
            <label className={`${styles.checkboxField} ${styles.fullField}`}><input type="checkbox" checked={draft.meeting?.timetableConfirmed ?? false} onChange={(event) => patchMeeting({ timetableConfirmed: event.target.checked })} /><span>当日タイムスケジュール確認済</span></label>
            <TextareaField label="備考" value={draft.meeting?.note ?? ""} onChange={(value) => patchMeeting({ note: value })} />
          </div>
        );
      case "documents":
        return (
          <div className={styles.repeater}>
            {(draft.documents ?? []).map((document, index) => (
              <div className={styles.repeaterItem} key={document.id}>
                <div className={styles.repeaterHeader}><strong>提出書類 {index + 1}</strong><button onClick={() => setDraft((current) => ({ ...current, documents: (current.documents ?? []).filter((_, documentIndex) => documentIndex !== index) }))}>削除</button></div>
                <div className={styles.formGrid}>
                  <Field label="書類名" value={document.name} onChange={(value) => updateDocument(index, { name: value })} />
                  <Field label="期限" type="date" value={document.deadline ?? ""} onChange={(value) => updateDocument(index, { deadline: value })} />
                  <label className={`${styles.checkboxField} ${styles.fullField}`}><input type="checkbox" checked={document.submitted ?? false} onChange={(event) => updateDocument(index, { submitted: event.target.checked })} /><span>提出済</span></label>
                  <TextareaField label="備考" value={document.note ?? ""} onChange={(value) => updateDocument(index, { note: value })} />
                </div>
              </div>
            ))}
            <button className={styles.addButton} onClick={() => setDraft((current) => ({ ...current, documents: [...(current.documents ?? []), { id: createId(), name: "", submitted: false }] }))}>＋提出書類を追加</button>
          </div>
        );
      default:
        return null;
    }
  }
}
