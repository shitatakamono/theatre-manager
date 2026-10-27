"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ProjectPerformanceRecord } from "@/lib/firestore";
import { updateProjectPerformanceSection } from "@/lib/firestore";
import { updateProjectPerformancePeopleSection } from "@/lib/performance-people-writes";
import { getProjectRevision, isConflictError } from "@/lib/project-revisions";
import { formatInformationValue, PERFORMANCE_INFORMATION_SECTIONS } from "@/lib/management-view";
import {
  getSelectablePerformancePeople,
  preparePerformancePeopleForSave,
  projectPersonToPerformanceDraft,
  resolveCastMemberPerson,
  resolveStaffMemberPerson,
  type PerformancePersonDraft,
} from "@/lib/performance-people";
import {
  getProjectPeopleWithFallback,
  type ProjectPerson,
  type ProjectPersonValues,
} from "@/lib/people";
import {
  REHEARSAL_PARTICIPATION_OPTIONS,
  toggleRehearsalParticipationType,
} from "@/lib/rehearsal-participation";
import { useProjectAccess } from "../ProjectAccess";
import {
  calculateEndTime,
  calculateTotalSeats,
  formatPerformanceDate,
  normalizePerformanceData,
  resolveSeatsPerPerformance,
  type CastMember,
  type ContactInfo,
  type CreditInfo,
  type CreditType,
  type PerformanceInfo,
  type PerformanceSection,
  type PerformanceShow,
  type ProjectPerformanceData,
  type StaffMember,
  type StaffRole,
  type TicketInfo,
  type VenueInfo,
} from "@/lib/performance";
import styles from "./performance-info.module.css";

const editorLabels: Record<PerformanceSection, string> = {
  performanceInfo: "基本情報",
  venue: "会場",
  performances: "タイムスケジュール",
  tickets: "料金",
  cast: "キャスト",
  staff: "スタッフ",
  contact: "問い合わせ・公式情報",
  credits: "協賛・協力等",
};

const creditLabels: Record<CreditType, string> = {
  support: "後援",
  sponsor: "協賛・スポンサー",
  cooperation: "協力",
  grant: "助成",
  other: "その他",
};

const standardStaffRoles = [
  "作",
  "演出",
  "舞台監督",
  "照明",
  "音響",
  "美術",
  "衣装",
  "制作",
  "広報",
  "写真",
  "映像",
] as const;

function createId() {
  return crypto.randomUUID();
}

function createStandardStaffTemplate(): StaffRole[] {
  return standardStaffRoles.map((role) => ({
    id: createId(),
    role,
    members: [],
  }));
}

function numberOrUndefined(value: string) {
  return value === "" ? undefined : Number(value);
}

function externalUrl(value: string) {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function formatPeriod(project: ProjectPerformanceRecord) {
  const start = project.showStartDate || project.startDate;
  const end = project.showEndDate || project.endDate;
  if (!start && !end) return "期間未設定";
  if (start && end) return `${start} 〜 ${end}`;
  return start || end || "期間未設定";
}

type CardProps = {
  id: string;
  title: string;
  section: PerformanceSection;
  children: React.ReactNode;
  onEdit: (section: PerformanceSection) => void;
};

function InfoCard({
  id,
  title,
  section,
  children,
  onEdit,
}: CardProps) {
  const { canEdit } = useProjectAccess();
  return (
    <section id={id} className={styles.card}>
      <header className={styles.cardHeader}>
        <h2>{title}</h2>
        {canEdit && <button className={styles.editButton} onClick={() => onEdit(section)}>
          編集
        </button>}
      </header>
      {children}
    </section>
  );
}

type FieldProps = {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number" | "date" | "time" | "email" | "url" | "tel";
  min?: number;
  placeholder?: string;
};

function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  placeholder,
}: FieldProps) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type={type}
        min={min}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

type TextareaFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
};

function TextareaField({ label, value, onChange, rows = 3 }: TextareaFieldProps) {
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

type PersonLinkEditorProps = {
  personId?: string;
  people: readonly ProjectPerson[];
  draftPerson?: PerformancePersonDraft;
  autoRegisterOnSave: boolean;
  onSelect: (personId: string) => void;
  onUpdate: (patch: Partial<ProjectPersonValues>) => void;
};

function PersonLinkEditor({
  personId,
  people,
  draftPerson,
  autoRegisterOnSave,
  onSelect,
  onUpdate,
}: PersonLinkEditorProps) {
  const selectablePeople = getSelectablePerformancePeople(people, personId);
  return (
    <div className={styles.personLinkEditor}>
      <label className={styles.field}>
        <span>関係者情報</span>
        <select value={personId ?? ""} onChange={(event) => onSelect(event.target.value)}>
          <option value="">未登録</option>
          {selectablePeople.map((person) => (
            <option key={person.id} value={person.id}>
              {person.displayName}{person.active ? "" : "（終了済み）"}
            </option>
          ))}
        </select>
      </label>
      {!personId && autoRegisterOnSave && <p className={styles.personCreateHint}>新しい関係者として自動登録されます</p>}
      {personId && draftPerson && (
        <div className={styles.personDetails}>
          <Field
            label="本名（管理用）"
            value={draftPerson.values.displayName}
            onChange={(displayName) => onUpdate({ displayName })}
          />
          <fieldset className={styles.participationFields}>
            <legend>参加する稽古</legend>
            <div>{REHEARSAL_PARTICIPATION_OPTIONS.map((option) => <label key={option.value}>
              <input
                type="checkbox"
                checked={draftPerson.values.rehearsalParticipationTypes.includes(option.value)}
                onChange={(event) => onUpdate({
                  rehearsalParticipationTypes: toggleRehearsalParticipationType(
                    draftPerson.values.rehearsalParticipationTypes,
                    option.value,
                    event.target.checked
                  ),
                })}
              />
              <span>{option.label}</span>
            </label>)}</div>
          </fieldset>
          <label className={styles.checkboxField}>
            <input
              type="checkbox"
              checked={draftPerson.values.attendanceTarget}
              onChange={(event) => onUpdate({ attendanceTarget: event.target.checked })}
            />
            出欠管理の対象にする
          </label>
          <TextareaField
            label="公開備考"
            value={draftPerson.values.publicNote}
            onChange={(publicNote) => onUpdate({ publicNote })}
            rows={2}
          />
          <p className={styles.personLinkStatus}>
            システム利用者: {draftPerson.values.linkedUserUid ? "連携済み" : "未連携"}
            <small>連携の変更は関係者管理で行ってください。</small>
          </p>
        </div>
      )}
    </div>
  );
}

export function PerformanceInfoClient({
  project,
  initialPeople,
}: {
  project: ProjectPerformanceRecord;
  initialPeople: ProjectPerson[];
}) {
  const { canEdit, actor } = useProjectAccess();
  const [data, setData] = useState<ProjectPerformanceData>(() =>
    normalizePerformanceData(project.data)
  );
  const [draft, setDraft] = useState<ProjectPerformanceData>(() =>
    normalizePerformanceData(project.data)
  );
  const [activeEditor, setActiveEditor] = useState<PerformanceSection | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [revision, setRevision] = useState(() => getProjectRevision(project.revisions, "performanceInfo"));
  const [expectedRevision, setExpectedRevision] = useState(revision);
  const [conflict, setConflict] = useState(false);
  const [people, setPeople] = useState<ProjectPerson[]>(initialPeople);
  const [personDrafts, setPersonDrafts] = useState<Record<string, PerformancePersonDraft>>(
    () => Object.fromEntries(initialPeople.map((person) => [person.id, projectPersonToPerformanceDraft(person)]))
  );
  const [configuredSections, setConfiguredSections] = useState<
    Set<PerformanceSection>
  >(
    () =>
      new Set(
        Object.keys(project.data).filter(
          (key): key is PerformanceSection =>
            project.data[key as PerformanceSection] !== undefined
        ) as PerformanceSection[]
      )
  );

  const basic = data.performanceInfo as PerformanceInfo;
  const venue = data.venue as VenueInfo;
  const shows = data.performances ?? [];
  const seatsPerPerformance = resolveSeatsPerPerformance(basic, shows.length);
  const totalSeats = calculateTotalSeats(basic, shows.length);
  const tickets = data.tickets as TicketInfo;
  const cast = useMemo(
    () => [...(data.cast ?? [])].sort((a, b) => a.order - b.order),
    [data.cast]
  );
  const staff = data.staff ?? [];
  const contact = data.contact as ContactInfo;
  const credits = data.credits ?? [];
  const displayTitle = basic.title || project.legacyTitle || "公演タイトル未設定";

  function openEditor(section: PerformanceSection) {
    if (!canEdit) return;
    const nextDraft = structuredClone(data);

    if (section === "staff" && !configuredSections.has("staff")) {
      nextDraft.staff = createStandardStaffTemplate();
    }

    setDraft(nextDraft);
    setPersonDrafts(Object.fromEntries(
      people.map((person) => [person.id, projectPersonToPerformanceDraft(person)])
    ));
    setSaveError("");
    setSavedMessage("");
    setConflict(false);
    setExpectedRevision(revision);
    setActiveEditor(section);
  }

  async function saveSection() {
    if (!activeEditor || !canEdit) return;
    const value = draft[activeEditor];
    if (value === undefined) return;

    setSaving(true);
    setSaveError("");
    setConflict(false);

    try {
      const preparedPeople = activeEditor === "cast" || activeEditor === "staff"
        ? preparePerformancePeopleForSave(
          activeEditor,
          value as CastMember[] | StaffRole[],
          (data[activeEditor] ?? []) as CastMember[] | StaffRole[],
          Object.values(personDrafts),
          createId
        )
        : null;
      const valueToSave = preparedPeople?.value ?? value;
      const result = preparedPeople
        ? await updateProjectPerformancePeopleSection(
          project.id,
          activeEditor as "cast" | "staff",
          valueToSave as CastMember[] | StaffRole[],
          preparedPeople.peopleDrafts,
          { actor, expectedRevision }
        )
        : await updateProjectPerformanceSection(project.id, activeEditor, value as never, {
          actor,
          expectedRevision,
        });

      if (result.changed) {
        setData((current) => ({ ...current, [activeEditor]: valueToSave }));
        setRevision(result.revision);
        setExpectedRevision(result.revision);
        setConfiguredSections((current) => {
          const next = new Set(current);
          next.add(activeEditor);
          return next;
        });
      }
      if (activeEditor === "cast" || activeEditor === "staff") {
        setPeople(await getProjectPeopleWithFallback(project.id));
      }
      setSavedMessage(result.changed ? `${editorLabels[activeEditor]}を保存しました` : "変更はありません");
      setActiveEditor(null);
    } catch (error) {
      if (isConflictError(error)) setConflict(true);
      setSaveError(
        error instanceof Error ? error.message : "保存できませんでした"
      );
    } finally {
      setSaving(false);
    }
  }

  function reloadLatest() {
    if (confirm("最新の内容を読み込むと、現在入力中の未保存内容は失われます。読み込みますか？")) {
      window.location.reload();
    }
  }

  function selectPerson(personId: string, apply: (personId: string | undefined) => void) {
    apply(personId || undefined);
  }

  function updatePersonDraft(personId: string, patch: Partial<ProjectPersonValues>) {
    setPersonDrafts((current) => {
      const draftPerson = current[personId];
      if (!draftPerson) return current;
      return {
        ...current,
        [personId]: {
          ...draftPerson,
          values: { ...draftPerson.values, ...patch },
        },
      };
    });
  }

  function patchBasic(patch: Partial<PerformanceInfo>) {
    setDraft((current) => ({
      ...current,
      performanceInfo: {
        ...(current.performanceInfo as PerformanceInfo),
        ...patch,
      },
    }));
  }

  function patchVenue(patch: Partial<VenueInfo>) {
    setDraft((current) => ({
      ...current,
      venue: { ...(current.venue as VenueInfo), ...patch },
    }));
  }

  function patchTickets(patch: Partial<TicketInfo>) {
    setDraft((current) => ({
      ...current,
      tickets: { ...(current.tickets as TicketInfo), ...patch },
    }));
  }

  function patchContact(patch: Partial<ContactInfo>) {
    setDraft((current) => ({
      ...current,
      contact: { ...(current.contact as ContactInfo), ...patch },
    }));
  }

  function updateShow(index: number, patch: Partial<PerformanceShow>) {
    setDraft((current) => ({
      ...current,
      performances: (current.performances ?? []).map((show, showIndex) =>
        showIndex === index ? { ...show, ...patch } : show
      ),
    }));
  }

  function updateCast(index: number, patch: Partial<CastMember>) {
    setDraft((current) => ({
      ...current,
      cast: (current.cast ?? []).map((member, memberIndex) =>
        memberIndex === index ? { ...member, ...patch } : member
      ),
    }));
  }

  function updateStaffRole(index: number, patch: Partial<StaffRole>) {
    setDraft((current) => ({
      ...current,
      staff: (current.staff ?? []).map((role, roleIndex) =>
        roleIndex === index ? { ...role, ...patch } : role
      ),
    }));
  }

  function updateStaffMember(
    roleIndex: number,
    memberIndex: number,
    patch: Partial<StaffMember>
  ) {
    const roles = draft.staff ?? [];
    const role = roles[roleIndex];
    updateStaffRole(roleIndex, {
      members: role.members.map((member, index) =>
        index === memberIndex ? { ...member, ...patch } : member
      ),
    });
  }

  function updateCredit(index: number, patch: Partial<CreditInfo>) {
    setDraft((current) => ({
      ...current,
      credits: (current.credits ?? []).map((credit, creditIndex) =>
        creditIndex === index ? { ...credit, ...patch } : credit
      ),
    }));
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div>
          <Link className={styles.backLink} href={`/projects/${project.id}`}>
            ← 公演トップ
          </Link>
          <p className={styles.eyebrow}>{basic.performanceName || "公演情報"}</p>
          <h1>{displayTitle}</h1>
          {basic.subtitle && <p className={styles.subtitle}>{basic.subtitle}</p>}
        </div>
        <div className={styles.heroFacts}>
          <span>{formatPeriod(project)}</span>
          <strong>{shows.length}公演</strong>
          <span>
            {basic.durationMinutes ? `${basic.durationMinutes}分` : "上演時間未設定"}
          </span>
        </div>
      </header>

      {savedMessage && <p className={styles.successMessage}>{savedMessage}</p>}

      <nav className={styles.sectionNav} aria-label="公演情報のセクション">
        {PERFORMANCE_INFORMATION_SECTIONS.map((link) => (
          <a key={link.id} href={`#${link.id}`}>{link.label}</a>
        ))}
      </nav>

      <div className={styles.dashboard}>
        <InfoCard
          id="basic"
          title="基本情報"
          section="performanceInfo"
          onEdit={openEditor}
        >
          <dl className={styles.detailList}>
            <div><dt>公演名称</dt><dd>{formatInformationValue(basic.performanceName)}</dd></div>
            <div><dt>タイトル</dt><dd>{displayTitle}</dd></div>
            <div><dt>サブタイトル</dt><dd>{formatInformationValue(basic.subtitle)}</dd></div>
            <div><dt>主催</dt><dd>{formatInformationValue(basic.organizer)}</dd></div>
            <div><dt>共催</dt><dd>{formatInformationValue(basic.coOrganizer)}</dd></div>
            <div><dt>後援</dt><dd>{formatInformationValue(basic.support)}</dd></div>
            <div><dt>上演時間</dt><dd>{basic.durationMinutes ? `${basic.durationMinutes}分（休憩込み）` : "未設定"}</dd></div>
            <div><dt>1公演あたりの座席数</dt><dd>{seatsPerPerformance === undefined ? "未設定" : `${seatsPerPerformance.toLocaleString()}席`}</dd></div>
            <div><dt>公演回数</dt><dd>{shows.length.toLocaleString()}回</dd></div>
            <div><dt>総席数</dt><dd>{totalSeats === undefined ? "未算出" : `${totalSeats.toLocaleString()}席`}</dd></div>
            <div><dt>休憩</dt><dd>{!configuredSections.has("performanceInfo") ? "未設定" : basic.hasIntermission ? `${basic.intermissionMinutes ?? "時間未設定"}分` : "なし"}</dd></div>
          </dl>
          <div className={styles.longDetails}>
            <div><h3>年齢制限</h3><p>{formatInformationValue(basic.ageRestriction)}</p></div>
            <div><h3>注意事項</h3><p>{formatInformationValue(basic.notice)}</p></div>
            <div><h3>公演概要・あらすじ</h3><p>{formatInformationValue(basic.synopsis)}</p></div>
          </div>
        </InfoCard>

        <InfoCard
          id="venue"
          title="公演日・会場"
          section="venue"
          onEdit={openEditor}
        >
          <dl className={styles.detailList}>
            <div><dt>公演期間</dt><dd>{formatPeriod(project)}</dd></div>
            <div><dt>公演回数</dt><dd>{shows.length ? `${shows.length}回` : "未入力"}</dd></div>
            <div><dt>会場名</dt><dd>{formatInformationValue(venue.name)}</dd></div>
            <div><dt>ホール・劇場名</dt><dd>{formatInformationValue(venue.hall)}</dd></div>
            <div><dt>所在地</dt><dd>{formatInformationValue(venue.address)}</dd></div>
            <div><dt>会場URL</dt><dd>{venue.url ? <a className={styles.inlineLink} href={externalUrl(venue.url)} target="_blank" rel="noreferrer">{venue.url} ↗</a> : "未設定"}</dd></div>
          </dl>
        </InfoCard>

        <InfoCard
          id="schedule"
          title="タイムスケジュール"
          section="performances"
          onEdit={openEditor}
        >
          {shows.length === 0 ? <p className={styles.empty}>公演回は未設定です</p> : (
            <div className={styles.showList}>
              {shows.map((show) => {
                const automaticEnd = calculateEndTime(show.startTime, basic.durationMinutes);
                const end = show.endTimeOverride || automaticEnd;
                return (
                  <div key={show.id} className={styles.showRow}>
                    <strong>{formatPerformanceDate(show.date)}</strong>
                    <span>開場 {show.openTime || "--:--"}</span>
                    <span>開演 {show.startTime || "--:--"}</span>
                    <span>終演 {end || "--:--"}{show.endTimeOverride && <small> 手動</small>}</span>
                    {show.note && <em>{show.note}</em>}
                  </div>
                );
              })}
            </div>
          )}
        </InfoCard>

        <InfoCard
          id="tickets"
          title="料金"
          section="tickets"
          onEdit={openEditor}
        >
          {!configuredSections.has("tickets") ? <p className={styles.empty}>未設定</p> : !tickets.isPaid ? <p className={styles.ticketStatus}>無料公演</p> : (
            <><p className={styles.ticketStatus}>有料公演</p><table className={styles.priceTable}><thead><tr><th></th><th>一般</th><th>学生</th></tr></thead><tbody><tr><th>前売</th><td>{tickets.advanceGeneral !== undefined ? `${tickets.advanceGeneral.toLocaleString()}円` : "未設定"}</td><td>{tickets.advanceStudent !== undefined ? `${tickets.advanceStudent.toLocaleString()}円` : "未設定"}</td></tr><tr><th>当日</th><td>{tickets.doorGeneral !== undefined ? `${tickets.doorGeneral.toLocaleString()}円` : "未設定"}</td><td>{tickets.doorStudent !== undefined ? `${tickets.doorStudent.toLocaleString()}円` : "未設定"}</td></tr></tbody></table></>
          )}
          {tickets.note && <p className={styles.muted}>{tickets.note}</p>}
        </InfoCard>

        <InfoCard
          id="cast"
          title={`キャスト ${cast.length ? `(${cast.length})` : ""}`}
          section="cast"
          onEdit={openEditor}
        >
          {cast.length === 0 ? <p className={styles.empty}>登録なし</p> : (
            <ul className={styles.peopleList}>
              {cast.map((member) => (
                <li key={member.id}>
                  <span><strong>{resolveCastMemberPerson(member, people).creditName}</strong>{member.affiliation && <small>{member.affiliation}</small>}</span>
                  {member.role && <em>{member.role}</em>}
                </li>
              ))}
            </ul>
          )}
        </InfoCard>

        <InfoCard
          id="staff"
          title="スタッフ"
          section="staff"
          onEdit={openEditor}
        >
          {staff.length === 0 ? <p className={styles.empty}>スタッフは未設定です</p> : (
            <dl className={styles.staffList}>
              {staff.map((role) => (
                <div key={role.id}><dt>{role.role || "役職未設定"}</dt><dd>{role.members.map((member) => resolveStaffMemberPerson(member, people).creditName).filter(Boolean).join(" / ") || "担当者未設定"}</dd></div>
              ))}
            </dl>
          )}
        </InfoCard>

        <InfoCard
          id="credits"
          title="協賛・協力・スポンサー・助成"
          section="credits"
          onEdit={openEditor}
        >
          {credits.length === 0 ? <p className={styles.empty}>登録なし</p> : (
            <ul className={styles.creditList}>
              {credits.map((credit) => (
                <li key={credit.id}><span>{creditLabels[credit.type]}</span><strong>{credit.displayName || credit.name}</strong>{credit.hasLogo && <small>ロゴあり</small>}</li>
              ))}
            </ul>
          )}
        </InfoCard>

        <InfoCard
          id="access"
          title="交通アクセス"
          section="venue"
          onEdit={openEditor}
        >
          <div className={styles.longDetails}><div><h3>会場までのアクセス</h3><p>{formatInformationValue(venue.access)}</p></div></div>
        </InfoCard>

        <InfoCard
          id="contact"
          title="問い合わせ・公式情報"
          section="contact"
          onEdit={openEditor}
        >
          <dl className={styles.detailList}>
            <div><dt>問い合わせ名称</dt><dd>{formatInformationValue(contact.name)}</dd></div>
            <div><dt>電話</dt><dd>{contact.phone ? <a href={`tel:${contact.phone}`}>{contact.phone}</a> : "未設定"}</dd></div>
            <div><dt>メール</dt><dd>{contact.email ? <a href={`mailto:${contact.email}`}>{contact.email}</a> : "未設定"}</dd></div>
            <div><dt>公式サイト</dt><dd>{contact.website ? <a href={externalUrl(contact.website)} target="_blank" rel="noreferrer">{contact.website} ↗</a> : "未設定"}</dd></div>
            <div><dt>X</dt><dd>{contact.x ? <a href={externalUrl(contact.x)} target="_blank" rel="noreferrer">{contact.x} ↗</a> : "未設定"}</dd></div>
            <div><dt>Instagram</dt><dd>{contact.instagram ? <a href={externalUrl(contact.instagram)} target="_blank" rel="noreferrer">{contact.instagram} ↗</a> : "未設定"}</dd></div>
            <div><dt>その他SNS</dt><dd>{formatInformationValue(contact.other)}</dd></div>
          </dl>
        </InfoCard>
      </div>

      {activeEditor && (
        <div className={styles.drawerLayer} role="presentation">
          <button className={styles.backdrop} aria-label="編集を閉じる" onClick={() => setActiveEditor(null)} />
          <aside className={styles.drawer} aria-label={`${editorLabels[activeEditor]}を編集`}>
            <header className={styles.drawerHeader}>
              <div><p>公演情報</p><h2>{editorLabels[activeEditor]}を編集</h2></div>
              <button aria-label="閉じる" onClick={() => setActiveEditor(null)}>×</button>
            </header>
            <div className={styles.drawerBody}>{renderEditor()}</div>
            <footer className={styles.drawerFooter}>
              {saveError && (conflict ? <div className={styles.conflictNotice} role="alert"><p>{saveError}</p><button onClick={reloadLatest}>最新の内容を読み込む</button></div> : <p>{saveError}</p>)}
              <button className={styles.cancelButton} onClick={() => setActiveEditor(null)} disabled={saving}>キャンセル</button>
              <button className={styles.saveButton} onClick={saveSection} disabled={saving}>{saving ? "保存中…" : "保存"}</button>
            </footer>
          </aside>
        </div>
      )}
    </main>
  );

  function renderEditor() {
    const draftBasic = draft.performanceInfo as PerformanceInfo;
    const draftVenue = draft.venue as VenueInfo;
    const draftTickets = draft.tickets as TicketInfo;
    const draftContact = draft.contact as ContactInfo;

    switch (activeEditor) {
      case "performanceInfo":
        return (
          <div className={styles.formGrid}>
            <Field label="公演名称" value={draftBasic.performanceName ?? ""} onChange={(value) => patchBasic({ performanceName: value })} />
            <Field label="公演タイトル" value={draftBasic.title ?? ""} onChange={(value) => patchBasic({ title: value })} placeholder={project.legacyTitle} />
            <Field label="サブタイトル" value={draftBasic.subtitle ?? ""} onChange={(value) => patchBasic({ subtitle: value })} />
            <Field label="主催" value={draftBasic.organizer ?? ""} onChange={(value) => patchBasic({ organizer: value })} />
            <Field label="共催" value={draftBasic.coOrganizer ?? ""} onChange={(value) => patchBasic({ coOrganizer: value })} />
            <Field label="後援" value={draftBasic.support ?? ""} onChange={(value) => patchBasic({ support: value })} />
            <Field label="上演時間（分・休憩込み）" type="number" min={1} value={draftBasic.durationMinutes ?? ""} onChange={(value) => patchBasic({ durationMinutes: numberOrUndefined(value) })} />
            <Field label="1公演あたりの座席数" type="number" min={0} value={draftBasic.seatsPerPerformance ?? ""} onChange={(value) => patchBasic({ seatsPerPerformance: numberOrUndefined(value), totalSeats: undefined })} />
            <Field label="年齢制限" value={draftBasic.ageRestriction ?? ""} onChange={(value) => patchBasic({ ageRestriction: value })} />
            <label className={`${styles.checkboxField} ${styles.fullField}`}><input type="checkbox" checked={draftBasic.hasIntermission} onChange={(event) => patchBasic({ hasIntermission: event.target.checked, intermissionMinutes: event.target.checked ? draftBasic.intermissionMinutes : undefined })} /><span>休憩あり</span></label>
            {draftBasic.hasIntermission && <Field label="休憩時間（分）" type="number" min={1} value={draftBasic.intermissionMinutes ?? ""} onChange={(value) => patchBasic({ intermissionMinutes: numberOrUndefined(value) })} />}
            <TextareaField label="注意事項" value={draftBasic.notice ?? ""} onChange={(value) => patchBasic({ notice: value })} />
            <TextareaField label="公演概要・あらすじ" value={draftBasic.synopsis ?? ""} rows={5} onChange={(value) => patchBasic({ synopsis: value })} />
          </div>
        );
      case "venue":
        return (
          <div className={styles.formGrid}>
            <Field label="会場名" value={draftVenue.name ?? ""} onChange={(value) => patchVenue({ name: value })} />
            <Field label="ホール・劇場名" value={draftVenue.hall ?? ""} onChange={(value) => patchVenue({ hall: value })} />
            <Field label="所在地" value={draftVenue.address ?? ""} onChange={(value) => patchVenue({ address: value })} />
            <Field label="会場URL" type="url" value={draftVenue.url ?? ""} onChange={(value) => patchVenue({ url: value })} />
            <TextareaField label="交通アクセス" value={draftVenue.access ?? ""} onChange={(value) => patchVenue({ access: value })} />
          </div>
        );
      case "performances":
        return (
          <div className={styles.repeater}>
            {(draft.performances ?? []).map((show, index) => {
              const autoEnd = calculateEndTime(show.startTime, draftBasic.durationMinutes);
              return (
                <div className={styles.repeaterItem} key={show.id}>
                  <div className={styles.repeaterHeader}><strong>公演回 {index + 1}</strong><button onClick={() => setDraft((current) => ({ ...current, performances: (current.performances ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>削除</button></div>
                  <div className={styles.formGrid}>
                    <Field label="日付" type="date" value={show.date} onChange={(value) => updateShow(index, { date: value })} />
                    <Field label="開場" type="time" value={show.openTime ?? ""} onChange={(value) => updateShow(index, { openTime: value })} />
                    <Field label="開演" type="time" value={show.startTime ?? ""} onChange={(value) => updateShow(index, { startTime: value })} />
                    <div className={styles.field}><span>終演予定</span><strong className={styles.calculatedValue}>{show.endTimeOverride || autoEnd || "未計算"} <small>{show.endTimeOverride ? "手動値" : autoEnd ? "自動計算" : ""}</small></strong></div>
                    <Field label="終演予定を手動上書き" type="time" value={show.endTimeOverride ?? ""} onChange={(value) => updateShow(index, { endTimeOverride: value })} />
                    <Field label="備考" value={show.note ?? ""} onChange={(value) => updateShow(index, { note: value })} />
                  </div>
                </div>
              );
            })}
            <button className={styles.addButton} onClick={() => setDraft((current) => ({ ...current, performances: [...(current.performances ?? []), { id: createId(), date: "" }] }))}>＋公演回を追加</button>
          </div>
        );
      case "tickets":
        return (
          <div className={styles.formGrid}>
            <label className={`${styles.checkboxField} ${styles.fullField}`}><input type="checkbox" checked={draftTickets.isPaid} onChange={(event) => patchTickets({ isPaid: event.target.checked })} /><span>有料公演</span></label>
            {draftTickets.isPaid && <>
              <Field label="前売一般" type="number" min={0} value={draftTickets.advanceGeneral ?? ""} onChange={(value) => patchTickets({ advanceGeneral: numberOrUndefined(value) })} />
              <Field label="前売学生" type="number" min={0} value={draftTickets.advanceStudent ?? ""} onChange={(value) => patchTickets({ advanceStudent: numberOrUndefined(value) })} />
              <Field label="当日一般" type="number" min={0} value={draftTickets.doorGeneral ?? ""} onChange={(value) => patchTickets({ doorGeneral: numberOrUndefined(value) })} />
              <Field label="当日学生" type="number" min={0} value={draftTickets.doorStudent ?? ""} onChange={(value) => patchTickets({ doorStudent: numberOrUndefined(value) })} />
            </>}
            <TextareaField label="備考" value={draftTickets.note ?? ""} onChange={(value) => patchTickets({ note: value })} />
          </div>
        );
      case "cast":
        return (
          <div className={styles.repeater}>
            {(draft.cast ?? []).map((member, index) => (
              <div className={styles.repeaterItem} key={member.id}>
                <div className={styles.repeaterHeader}><strong>出演者 {index + 1}</strong><button onClick={() => setDraft((current) => ({ ...current, cast: (current.cast ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>削除</button></div>
                <div className={styles.formGrid}>
                  <Field label="表示順" type="number" min={1} value={member.order} onChange={(value) => updateCast(index, { order: Number(value) || index + 1 })} />
                  <Field label="氏名" value={member.name} onChange={(value) => updateCast(index, { name: value })} />
                  <Field label="所属団体" value={member.affiliation ?? ""} onChange={(value) => updateCast(index, { affiliation: value })} />
                  <Field label="役名" value={member.role ?? ""} onChange={(value) => updateCast(index, { role: value })} />
                  <Field label="掲載名・芸名" value={member.displayName ?? ""} onChange={(value) => updateCast(index, { displayName: value })} placeholder="空欄時は本名を表示" />
                </div>
                <PersonLinkEditor
                  personId={member.personId}
                  people={people}
                  draftPerson={member.personId ? personDrafts[member.personId] : undefined}
                  autoRegisterOnSave={!(data.cast ?? []).some(({ id }) => id === member.id)}
                  onSelect={(personId) => selectPerson(personId, (nextPersonId) => updateCast(index, { personId: nextPersonId }))}
                  onUpdate={(patch) => member.personId && updatePersonDraft(member.personId, patch)}
                />
              </div>
            ))}
            <button className={styles.addButton} onClick={() => setDraft((current) => ({ ...current, cast: [...(current.cast ?? []), { id: createId(), order: (current.cast?.length ?? 0) + 1, name: "" }] }))}>＋出演者を追加</button>
          </div>
        );
      case "staff":
        return (
          <div className={styles.repeater}>
            {(draft.staff ?? []).map((role, roleIndex) => (
              <div className={styles.repeaterItem} key={role.id}>
                <div className={styles.repeaterHeader}><Field label="役職" value={role.role} onChange={(value) => updateStaffRole(roleIndex, { role: value })} /><button onClick={() => setDraft((current) => ({ ...current, staff: (current.staff ?? []).filter((_, index) => index !== roleIndex) }))}>役職を削除</button></div>
                <div className={styles.memberList}>
                  {role.members.map((member, memberIndex) => (
                    <div className={styles.memberRow} key={member.id}>
                      <Field label="氏名" value={member.name} onChange={(value) => updateStaffMember(roleIndex, memberIndex, { name: value })} />
                      <Field label="掲載名（クレジット）" value={member.creditName ?? ""} onChange={(value) => updateStaffMember(roleIndex, memberIndex, { creditName: value })} placeholder="空欄時は本名を表示" />
                      <button onClick={() => updateStaffRole(roleIndex, { members: role.members.filter((_, index) => index !== memberIndex) })}>削除</button>
                      <PersonLinkEditor
                        personId={member.personId}
                        people={people}
                        draftPerson={member.personId ? personDrafts[member.personId] : undefined}
                        autoRegisterOnSave={!(data.staff ?? []).some((savedRole) => savedRole.members.some(({ id }) => id === member.id))}
                        onSelect={(personId) => selectPerson(personId, (nextPersonId) => updateStaffMember(roleIndex, memberIndex, { personId: nextPersonId }))}
                        onUpdate={(patch) => member.personId && updatePersonDraft(member.personId, patch)}
                      />
                    </div>
                  ))}
                  <button className={styles.subAddButton} onClick={() => updateStaffRole(roleIndex, { members: [...role.members, { id: createId(), name: "" }] })}>＋ この役職に担当者を追加</button>
                </div>
              </div>
            ))}
            <button className={styles.addButton} onClick={() => setDraft((current) => ({ ...current, staff: [...(current.staff ?? []), { id: createId(), role: "", members: [] }] }))}>＋役職を追加</button>
          </div>
        );
      case "contact":
        return (
          <div className={styles.formGrid}>
            <Field label="問い合わせ名称" value={draftContact.name ?? ""} onChange={(value) => patchContact({ name: value })} />
            <Field label="電話" type="tel" value={draftContact.phone ?? ""} onChange={(value) => patchContact({ phone: value })} />
            <Field label="メール" type="email" value={draftContact.email ?? ""} onChange={(value) => patchContact({ email: value })} />
            <Field label="公式サイト" type="url" value={draftContact.website ?? ""} onChange={(value) => patchContact({ website: value })} />
            <Field label="X" type="url" value={draftContact.x ?? ""} onChange={(value) => patchContact({ x: value })} />
            <Field label="Instagram" type="url" value={draftContact.instagram ?? ""} onChange={(value) => patchContact({ instagram: value })} />
            <TextareaField label="その他SNS" value={draftContact.other ?? ""} onChange={(value) => patchContact({ other: value })} />
          </div>
        );
      case "credits":
        return (
          <div className={styles.repeater}>
            {(draft.credits ?? []).map((credit, index) => (
              <div className={styles.repeaterItem} key={credit.id}>
                <div className={styles.repeaterHeader}><strong>掲載情報 {index + 1}</strong><button onClick={() => setDraft((current) => ({ ...current, credits: (current.credits ?? []).filter((_, itemIndex) => itemIndex !== index) }))}>削除</button></div>
                <div className={styles.formGrid}>
                  <label className={styles.field}><span>種別</span><select value={credit.type} onChange={(event) => updateCredit(index, { type: event.target.value as CreditType })}>{Object.entries(creditLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <Field label="正式名称" value={credit.name} onChange={(value) => updateCredit(index, { name: value })} />
                  <Field label="掲載表記" value={credit.displayName ?? ""} onChange={(value) => updateCredit(index, { displayName: value })} />
                  <label className={styles.checkboxField}><input type="checkbox" checked={credit.hasLogo} onChange={(event) => updateCredit(index, { hasLogo: event.target.checked })} /><span>ロゴ素材あり</span></label>
                  <TextareaField label="備考" value={credit.note ?? ""} onChange={(value) => updateCredit(index, { note: value })} />
                </div>
              </div>
            ))}
            <button className={styles.addButton} onClick={() => setDraft((current) => ({ ...current, credits: [...(current.credits ?? []), { id: createId(), type: "support", name: "", hasLogo: false }] }))}>＋掲載情報を追加</button>
          </div>
        );
      default:
        return null;
    }
  }
}
