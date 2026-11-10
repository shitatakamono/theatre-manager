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

type LineStatusResponse = {
  connected?: boolean;
  deliveryStatus?: "reachable" | "unreachable" | "unknown" | null;
  error?: string;
  code?: string;
};

type LineLoginStartResponse = {
  connected?: boolean;
  redirectUrl?: string;
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

const LINE_RESULT_MESSAGES: Record<string, { text: string; tone: "success" | "error" }> = {
  connected: { text: "LINEとの連携が完了しました。", tone: "success" },
  error: { text: "LINEとの連携を完了できませんでした。もう一度お試しください。", tone: "error" },
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
  const [lineConnected, setLineConnected] = useState(false);
  const [lineLoading, setLineLoading] = useState(true);
  const [lineProcessing, setLineProcessing] = useState(false);
  const [lineError, setLineError] = useState("");
  const [lineNotice, setLineNotice] = useState("");
  const resultStatus = searchParams.get("googleCalendar");
  const result = resultStatus ? RESULT_MESSAGES[resultStatus] ?? null : null;
  const lineResultStatus = searchParams.get("line");
  const lineResult = lineResultStatus ? LINE_RESULT_MESSAGES[lineResultStatus] ?? null : null;
  const visibleLineResult = lineResultStatus === "connected" && !lineConnected ? null : lineResult;

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

  useEffect(() => {
    if (!profile) return;

    let active = true;
    void (async () => {
      setLineLoading(true);
      setLineError("");
      try {
        const response = await fetch("/api/line/login/status", {
          headers: await getAuthorizationHeader(),
        });
        const data = await readJson<LineStatusResponse>(response);
        if (!response.ok) throw new Error(data.error || "LINEの連携状態を確認できませんでした");
        if (active) setLineConnected(data.connected === true);
      } catch (loadError) {
        if (active) setLineError(loadError instanceof Error ? loadError.message : "LINEの連携状態を確認できませんでした");
      } finally {
        if (active) setLineLoading(false);
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

  async function connectLine() {
    if (lineProcessing) return;
    setLineProcessing(true);
    setLineError("");
    setLineNotice("");
    try {
      const response = await fetch("/api/line/login/start", {
        method: "POST",
        headers: await getAuthorizationHeader(),
      });
      const data = await readJson<LineLoginStartResponse>(response);
      if (!response.ok) throw new Error(data.error || "LINE連携を開始できませんでした");
      if (data.connected) {
        setLineConnected(true);
        setLineProcessing(false);
        return;
      }
      if (!data.redirectUrl) throw new Error("LINE連携を開始できませんでした");
      const redirect = new URL(data.redirectUrl);
      if (redirect.origin !== "https://access.line.me") {
        throw new Error("LINE連携を開始できませんでした");
      }
      window.location.assign(redirect.toString());
    } catch (connectError) {
      setLineError(connectError instanceof Error ? connectError.message : "LINE連携を開始できませんでした");
      setLineProcessing(false);
    }
  }

  async function disconnectLine() {
    if (lineProcessing) return;
    const confirmed = window.confirm(
      "LINEとの連携を解除しますか？\n解除すると、SeisakuBoardからLINEで通知を受け取れなくなります。\nLINE公式アカウントの友だち登録は解除されません。"
    );
    if (!confirmed) return;

    setLineProcessing(true);
    setLineError("");
    setLineNotice("");
    try {
      const response = await fetch("/api/line/login/disconnect", {
        method: "POST",
        headers: await getAuthorizationHeader(),
      });
      const data = await readJson<LineStatusResponse>(response);
      if (!response.ok) {
        if (data.code === "last_login_method") {
          throw new Error("LINE以外のログイン方法がないため解除できません。先にGoogleでログインできる状態をご確認ください。");
        }
        throw new Error(data.error || "LINE連携を解除できませんでした");
      }
      setLineConnected(false);
      setLineNotice("LINEとの連携を解除しました。");
    } catch (disconnectError) {
      setLineError(disconnectError instanceof Error
        ? disconnectError.message
        : "LINE連携を解除できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setLineProcessing(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p>PERSONAL SETTINGS</p><h1>個人設定</h1></div>
        <Link href="/projects">公演一覧へ戻る</Link>
      </header>

      {result && <p className={styles.result} data-tone={result.tone} role={result.tone === "error" ? "alert" : "status"}>{result.text}</p>}
      {visibleLineResult && <p className={styles.result} data-tone={visibleLineResult.tone} role={visibleLineResult.tone === "error" ? "alert" : "status"}>{visibleLineResult.text}</p>}

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

      <section className={styles.section} aria-labelledby="line-title">
        <div className={styles.sectionHeading}>
          <div>
            <p>LINE</p>
            <h2 id="line-title">LINE連携</h2>
          </div>
          {!lineLoading && <span className={styles.status} data-connected={lineConnected}>{lineConnected ? "連携済み" : "未連携"}</span>}
        </div>

        <p className={styles.description}>LINEでお知らせを受け取るための個人設定です。</p>

        {lineLoading ? <p className={styles.loading}>連携状態を確認しています…</p> : (
          <div className={styles.actions}>
            {lineConnected ? (
              <div className={styles.lineConnectedActions}>
                <p className={styles.connectedMessage}>LINEとの連携が完了しています。</p>
                <button className={styles.disconnectButton} type="button" disabled={lineProcessing} onClick={() => void disconnectLine()}>{lineProcessing ? "解除中…" : "LINE連携を解除"}</button>
              </div>
            ) : (
              <button className={styles.lineConnectButton} type="button" disabled={lineProcessing} onClick={() => void connectLine()}>{lineProcessing ? "接続中…" : "LINEと連携"}</button>
            )}
          </div>
        )}

        {lineNotice && <p className={styles.notice} role="status">{lineNotice}</p>}
        {lineError && <p className={styles.error} role="alert">{lineError}</p>}
      </section>
    </main>
  );
}

export default function SettingsPage() {
  return <Suspense fallback={<main className={styles.page}><p className={styles.loading}>設定を読み込んでいます…</p></main>}><SettingsContent /></Suspense>;
}
