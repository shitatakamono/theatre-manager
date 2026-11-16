"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { auth } from "@/lib/firebase";
import {
  GOOGLE_CALENDAR_SYNC_TYPES,
  normalizeGoogleCalendarSyncTypes,
} from "@/lib/google-calendar-sync-preferences";
import { REHEARSAL_TYPE_LABELS, type RehearsalType } from "@/lib/rehearsals";

import styles from "./rehearsals.module.css";

type SettingsResponse = {
  configured?: boolean;
  connected?: boolean;
  rehearsalTypes?: RehearsalType[];
  error?: string;
};

async function authorizationHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error("ログイン情報を確認できませんでした");
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

export function GoogleCalendarSyncSettings({ projectId }: { projectId: string }) {
  const [selected, setSelected] = useState<RehearsalType[]>([]);
  const [configured, setConfigured] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/google-calendar/project-settings?projectId=${encodeURIComponent(projectId)}`, {
          headers: await authorizationHeader(),
        });
        const data = await response.json().catch(() => ({})) as SettingsResponse;
        if (!response.ok || !Array.isArray(data.rehearsalTypes)) {
          throw new Error(data.error || "同期設定を確認できませんでした");
        }
        if (!active) return;
        setSelected(normalizeGoogleCalendarSyncTypes(data.rehearsalTypes));
        setConfigured(data.configured === true);
        setConnected(data.connected === true);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "同期設定を確認できませんでした");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [projectId]);

  function toggle(type: RehearsalType, checked: boolean) {
    setSelected((current) => normalizeGoogleCalendarSyncTypes(
      checked ? [...current, type] : current.filter((value) => value !== type)
    ));
    setNotice("");
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/google-calendar/project-settings", {
        method: "PATCH",
        headers: {
          ...(await authorizationHeader()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ projectId, rehearsalTypes: selected }),
      });
      const data = await response.json().catch(() => ({})) as SettingsResponse;
      if (!response.ok) throw new Error(data.error || "同期設定を保存できませんでした");
      setConfigured(true);
      setNotice("Googleカレンダーの同期対象を保存しました。反映には少し時間がかかる場合があります。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "同期設定を保存できませんでした");
    } finally {
      setSaving(false);
    }
  }

  return <section className={styles.calendarSettings} aria-labelledby="calendar-sync-settings-title">
    <div className={styles.calendarSettingsHeading}>
      <div><p>GOOGLE CALENDAR</p><h2 id="calendar-sync-settings-title">同期する稽古</h2></div>
      {!loading && <span data-connected={connected}>{connected ? "連携済み" : "未連携"}</span>}
    </div>
    <p className={styles.settingDescription}>画面に表示する稽古とは別に、この公演からGoogleカレンダーへ同期する種類を選びます。</p>
    {loading ? <p className={styles.empty}>同期設定を確認しています…</p> : <>
      <fieldset className={styles.typeChecks} disabled={saving}>
        <legend className={styles.visuallyHidden}>Googleカレンダーへ同期する稽古種類</legend>
        {GOOGLE_CALENDAR_SYNC_TYPES.map((type) => <label key={type}>
          <input type="checkbox" checked={selected.includes(type)} onChange={(event) => toggle(type, event.target.checked)} />
          <span>{REHEARSAL_TYPE_LABELS[type]}</span>
        </label>)}
      </fieldset>
      <div className={styles.filterActions}>
        <button type="button" disabled={saving} onClick={() => setSelected([...GOOGLE_CALENDAR_SYNC_TYPES])}>すべて選択</button>
        <button type="button" disabled={saving} onClick={() => setSelected([])}>すべて解除</button>
        <button className={styles.primaryCompactButton} type="button" disabled={saving} onClick={() => void save()}>{saving ? "保存中…" : "同期対象を保存"}</button>
      </div>
      {!configured && <p className={styles.settingHint}>未保存のため、現在は従来の参加部門に基づく同期対象を表示しています。</p>}
      {!connected && <p className={styles.settingHint}>同期を開始するには、<Link href="/settings">個人設定でGoogleカレンダーを連携</Link>してください。</p>}
    </>}
    {notice && <p className={styles.inlineNotice} role="status">{notice}</p>}
    {error && <p className={styles.inlineError} role="alert">{error}</p>}
  </section>;
}
