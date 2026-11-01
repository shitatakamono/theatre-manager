"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useAuth } from "@/app/AuthProvider";
import { auth } from "@/lib/firebase";

import styles from "./settings.module.css";

type CalendarStatusResponse = {
  connected?: boolean;
  error?: string;
};

type CalendarConnectResponse = {
  authorizationUrl?: string;
  error?: string;
};

const RESULT_MESSAGES: Record<string, { text: string; tone: "success" | "info" | "error" }> = {
  connected: { text: "Googleカレンダーとの連携が完了しました。", tone: "success" },
  cancelled: { text: "Googleカレンダーとの連携をキャンセルしました。", tone: "info" },
  invalid_callback: { text: "Googleカレンダーからの応答を確認できませんでした。もう一度お試しください。", tone: "error" },
  invalid_state: { text: "連携リクエストの有効期限が切れているか、確認できませんでした。もう一度お試しください。", tone: "error" },
  server_configuration: { text: "Googleカレンダー連携の設定が不足しています。管理者にお問い合わせください。", tone: "error" },
  token_exchange_failed: { text: "Googleカレンダーとの認証を完了できませんでした。もう一度お試しください。", tone: "error" },
  missing_refresh_token: { text: "Googleカレンダーとの継続的な連携を開始できませんでした。もう一度お試しください。", tone: "error" },
  failed: { text: "Googleカレンダーとの連携に失敗しました。もう一度お試しください。", tone: "error" },
};

async function getAuthorizationHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error("ログイン情報を確認できませんでした");

  return { Authorization: `Bearer ${await user.getIdToken()}` };
}

async function readJson<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>;
}

function SettingsContent() {
  const { profile } = useAuth();
  const searchParams = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const resultStatus = searchParams.get("googleCalendar");
  const result = resultStatus ? RESULT_MESSAGES[resultStatus] ?? null : null;

  useEffect(() => {
    if (!profile) return;

    let active = true;
    void (async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/google-calendar/status", {
          headers: await getAuthorizationHeader(),
        });
        const data = await readJson<CalendarStatusResponse>(response);
        if (!response.ok) throw new Error(data.error || "Googleカレンダーの連携状態を確認できませんでした");
        if (active) setConnected(data.connected === true);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Googleカレンダーの連携状態を確認できませんでした");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; };
  }, [profile]);

  async function connect() {
    setProcessing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/google-calendar/connect", {
        method: "POST",
        headers: await getAuthorizationHeader(),
      });
      const data = await readJson<CalendarConnectResponse>(response);
      if (!response.ok || !data.authorizationUrl) {
        throw new Error(data.error || "Googleカレンダー連携を開始できませんでした");
      }
      window.location.href = data.authorizationUrl;
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Googleカレンダー連携を開始できませんでした");
      setProcessing(false);
    }
  }

  async function disconnect() {
    setProcessing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/google-calendar/disconnect", {
        method: "POST",
        headers: await getAuthorizationHeader(),
      });
      const data = await readJson<CalendarStatusResponse>(response);
      if (!response.ok) throw new Error(data.error || "Googleカレンダーとの連携を解除できませんでした");
      setConnected(false);
      setNotice("Googleカレンダーとの連携を解除しました。");
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Googleカレンダーとの連携を解除できませんでした");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p>PERSONAL SETTINGS</p><h1>個人設定</h1></div>
        <Link href="/">公演一覧へ戻る</Link>
      </header>

      {result && <p className={styles.result} data-tone={result.tone} role={result.tone === "error" ? "alert" : "status"}>{result.text}</p>}

      <section className={styles.section} aria-labelledby="google-calendar-title">
        <div className={styles.sectionHeading}>
          <div>
            <p>CALENDAR</p>
            <h2 id="google-calendar-title">Googleカレンダー連携</h2>
          </div>
          {!loading && <span className={styles.status} data-connected={connected}>{connected ? "連携済み" : "未連携"}</span>}
        </div>

        <p className={styles.description}>稽古予定をGoogleカレンダーと連携するための個人設定です。</p>

        {loading ? <p className={styles.loading}>連携状態を確認しています…</p> : (
          <div className={styles.actions}>
            {connected ? (
              <button className={styles.disconnectButton} type="button" disabled={processing} onClick={() => void disconnect()}>{processing ? "解除中…" : "連携を解除"}</button>
            ) : (
              <button className={styles.connectButton} type="button" disabled={processing} onClick={() => void connect()}>{processing ? "接続中…" : "Googleカレンダーと連携"}</button>
            )}
          </div>
        )}

        {notice && <p className={styles.notice} role="status">{notice}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </section>
    </main>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={<main className={styles.page}><p className={styles.loading}>設定を読み込んでいます…</p></main>}><SettingsContent /></Suspense>;
}
