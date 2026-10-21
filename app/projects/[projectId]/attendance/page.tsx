"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/AuthProvider";
import {
  getProjectAttendanceRecords,
  upsertProjectAttendanceRecords,
  type AttendanceRecord,
  type AttendanceStatus,
} from "@/lib/attendance";
import {
  buildAttendanceDrafts,
  buildFutureRehearsalDays,
  buildSharedAttendanceRows,
  findSelfParticipant,
  formatRehearsalDayItem,
  getChangedAttendanceInputs,
  type AttendanceDraft,
} from "@/lib/attendance-view";
import {
  SPECIAL_PRACTICE_LABELS,
  getProjectParticipants,
  type Participant,
} from "@/lib/participants";
import { getAllProjectRehearsals, type Rehearsal } from "@/lib/rehearsals";
import styles from "./attendance.module.css";

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; mark: string }[] = [
  { value: "attending", label: "参加", mark: "○" },
  { value: "absent", label: "不参加", mark: "×" },
  { value: "tentative", label: "未定", mark: "△" },
];

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  attending: "参加",
  absent: "不参加",
  tentative: "未定",
};

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(new Date(`${date}T00:00:00+09:00`));
}

function attendanceText(record: AttendanceRecord | null): string {
  if (!record) return "未回答";
  if (record.status !== "attending") return STATUS_LABELS[record.status];
  return `${record.availableFrom ?? "--:--"}〜${record.availableUntil ?? "--:--"}`;
}

async function fetchAttendancePageData(projectId: string) {
  const [participants, rehearsals, records] = await Promise.all([
    getProjectParticipants(projectId),
    getAllProjectRehearsals(projectId),
    getProjectAttendanceRecords(projectId),
  ]);
  return { participants, rehearsals, records };
}

export default function AttendancePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params);
  const { profile } = useAuth();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [rehearsals, setRehearsals] = useState<Rehearsal[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, AttendanceDraft>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");

  const days = useMemo(() => buildFutureRehearsalDays(rehearsals), [rehearsals]);
  const selfParticipant = useMemo(
    () => profile ? findSelfParticipant(participants, profile.uid) : null,
    [participants, profile]
  );

  async function load() {
    setLoading(true);
    setLoadError("");
    try {
      const { participants: participantItems, rehearsals: rehearsalItems, records: attendanceItems } = await fetchAttendancePageData(projectId);
      setParticipants(participantItems);
      setRehearsals(rehearsalItems);
      setRecords(attendanceItems);
      const self = profile ? findSelfParticipant(participantItems, profile.uid) : null;
      const futureDays = buildFutureRehearsalDays(rehearsalItems);
      setDrafts(self ? buildAttendanceDrafts(futureDays, self.id, attendanceItems) : {});
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "出欠情報を読み込めませんでした");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchAttendancePageData(projectId)
      .then(({ participants: participantItems, rehearsals: rehearsalItems, records: attendanceItems }) => {
        if (!active) return;
        setParticipants(participantItems);
        setRehearsals(rehearsalItems);
        setRecords(attendanceItems);
        const self = profile ? findSelfParticipant(participantItems, profile.uid) : null;
        setDrafts(self ? buildAttendanceDrafts(buildFutureRehearsalDays(rehearsalItems), self.id, attendanceItems) : {});
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "出欠情報を読み込めませんでした");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, profile]);

  function patchDraft(date: string, patch: Partial<AttendanceDraft>) {
    setDrafts((current) => ({ ...current, [date]: { ...current[date], ...patch } }));
    setNotice("");
    setSaveError("");
  }

  function selectStatus(date: string, status: AttendanceStatus) {
    const day = days.find((item) => item.date === date);
    patchDraft(date, status === "attending" ? {
      status,
      availableFrom: drafts[date]?.availableFrom ?? day?.fullTimeRange?.from ?? null,
      availableUntil: drafts[date]?.availableUntil ?? day?.fullTimeRange?.until ?? null,
    } : { status, availableFrom: null, availableUntil: null });
  }

  async function saveAll() {
    if (!profile || !selfParticipant || !selfParticipant.active || saving) return;
    setSaving(true);
    setSaveError("");
    setNotice("");
    try {
      const inputs = getChangedAttendanceInputs(days, selfParticipant.id, drafts, records);
      if (inputs.length === 0) {
        setNotice("保存する変更はありません");
        return;
      }
      await upsertProjectAttendanceRecords(projectId, inputs, profile.uid);
      const attendanceItems = await getProjectAttendanceRecords(projectId);
      setRecords(attendanceItems);
      setDrafts(buildAttendanceDrafts(days, selfParticipant.id, attendanceItems));
      setNotice(`${inputs.length}日分の出欠を保存しました`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "出欠を保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><Link href={`/projects/${projectId}`}>← 公演トップ</Link><p>ATTENDANCE</p><h1>出欠管理</h1></div>
      </header>

      {loadError && <p className={styles.error} role="alert">{loadError} <button type="button" onClick={() => void load()}>再読み込み</button></p>}
      {loading ? <p className={styles.empty}>読み込み中…</p> : <>
        <section className={styles.selfSection} aria-labelledby="self-attendance-title">
          <div className={styles.sectionHeading}><div><p>MY ATTENDANCE</p><h2 id="self-attendance-title">自分の出欠予定</h2></div>{selfParticipant?.active && days.length > 0 && <button type="button" disabled={saving} onClick={() => void saveAll()}>{saving ? "保存中…" : "まとめて保存"}</button>}</div>
          {!selfParticipant ? <p className={styles.guidance}>あなたのアカウントは参加者情報とまだ紐付けられていません。制作担当者にアカウント紐付けを依頼してください。</p>
            : !selfParticipant.active ? <p className={styles.guidance}>参加者情報が終了状態のため、現在は出欠を入力できません。</p>
              : days.length === 0 ? <p className={styles.empty}>今後の稽古予定はありません。</p>
                : <div className={styles.cards}>{days.map((day) => {
                  const draft = drafts[day.date] ?? { status: null, availableFrom: null, availableUntil: null, publicNote: "" };
                  return <article className={styles.card} key={day.date}>
                    <div className={styles.cardHeader}><div><h3>{formatDate(day.date)}</h3><span>{draft.status ? STATUS_LABELS[draft.status] : "未回答"}</span></div><ul>{day.rehearsals.map((rehearsal) => <li key={rehearsal.id}>{formatRehearsalDayItem(rehearsal)}{rehearsal.venue ? ` / ${rehearsal.venue}` : ""}</li>)}</ul></div>
                    <div className={styles.statusOptions} aria-label={`${formatDate(day.date)}の出欠`}>{STATUS_OPTIONS.map((option) => <button type="button" data-selected={draft.status === option.value} key={option.value} onClick={() => selectStatus(day.date, option.value)}><b>{option.mark}</b>{option.label}</button>)}</div>
                    {draft.status === "attending" && <div className={styles.timeFields}>
                      <label><span>参加可能時間</span><input type="time" value={draft.availableFrom ?? ""} onChange={(event) => patchDraft(day.date, { availableFrom: event.target.value || null })} /></label><span>〜</span><label><span className={styles.visuallyHidden}>終了時刻</span><input type="time" value={draft.availableUntil ?? ""} onChange={(event) => patchDraft(day.date, { availableUntil: event.target.value || null })} /></label>
                      <button type="button" disabled={!day.fullTimeRange} onClick={() => day.fullTimeRange && patchDraft(day.date, { availableFrom: day.fullTimeRange.from, availableUntil: day.fullTimeRange.until })}>その日の全時間参加</button>
                      {!day.fullTimeRange && <small>終了時刻未設定の稽古があるため自動入力できません。</small>}
                    </div>}
                    <label className={styles.noteField}><span>公開備考</span><textarea disabled={draft.status === null} maxLength={2000} rows={2} value={draft.publicNote} onChange={(event) => patchDraft(day.date, { publicNote: event.target.value })} placeholder={draft.status === null ? "先に出欠を選択してください" : "参加者全員に公開されます"} /></label>
                    {draft.status === null && <small className={styles.noteHint}>参加・不参加・未定を選択すると備考を入力できます。</small>}
                  </article>;
                })}</div>}
          {notice && <p className={styles.success} role="status">{notice}</p>}
          {saveError && <p className={styles.error} role="alert">{saveError}</p>}
        </section>

        <section className={styles.sharedSection} aria-labelledby="shared-attendance-title">
          <div className={styles.sectionHeading}><div><p>TEAM SCHEDULE</p><h2 id="shared-attendance-title">全員の出欠</h2></div></div>
          {days.length === 0 ? <p className={styles.empty}>今後の稽古予定はありません。</p> : <div className={styles.sharedDays}>{days.map((day) => <article key={day.date}><h3>{formatDate(day.date)}</h3><div className={styles.tableWrap}><table><thead><tr><th>参加者</th><th>特別稽古</th><th>出欠</th><th>参加可能時間</th><th>公開備考</th></tr></thead><tbody>{buildSharedAttendanceRows(day.date, participants, records).map(({ participant, record }) => <tr key={participant.id}><td data-label="参加者"><strong>{participant.displayName}</strong></td><td data-label="特別稽古"><span className={styles.badge}>{SPECIAL_PRACTICE_LABELS[participant.specialPractice]}</span></td><td data-label="出欠" data-status={record?.status ?? "unanswered"}>{record ? STATUS_LABELS[record.status] : "未回答"}</td><td data-label="参加可能時間">{attendanceText(record)}</td><td data-label="公開備考" className={styles.publicNote}>{record?.publicNote || "—"}</td></tr>)}</tbody></table></div></article>)}</div>}
        </section>
      </>}
    </main>
  );
}
