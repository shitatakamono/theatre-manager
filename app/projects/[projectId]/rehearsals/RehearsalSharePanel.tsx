"use client";

import { useEffect, useState } from "react";
import { auth } from "@/lib/firebase";
import styles from "./rehearsals.module.css";

type ShareStatus = { enabled: boolean; path: string | null };

export function RehearsalSharePanel({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function request(method: "GET" | "POST" | "PATCH" | "DELETE"): Promise<ShareStatus> {
    const user = auth.currentUser;
    if (!user) throw new Error("ログイン情報を確認できませんでした");
    const idToken = await user.getIdToken();
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/rehearsal-share`, {
      method,
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error("共有設定を更新できませんでした");
    return response.json() as Promise<ShareStatus>;
  }

  useEffect(() => {
    let active = true;
    void request("GET")
      .then((result) => { if (active) setStatus(result); })
      .catch(() => { if (active) setError("共有設定を読み込めませんでした"); });
    return () => { active = false; };
    // projectId is the only stable input; Firebase auth state is established by the surrounding project boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function update(method: "POST" | "PATCH" | "DELETE") {
    if (!canManage) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await request(method);
      setStatus(result);
      setMessage(method === "DELETE" ? "共有を停止しました" : method === "PATCH" ? "共有URLを再発行しました" : "共有URLを発行しました");
    } catch {
      setError("共有設定を更新できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!status?.path) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${status.path}`);
      setMessage("共有URLをコピーしました");
      setError("");
    } catch {
      setError("URLをコピーできませんでした。ブラウザの設定をご確認ください。");
    }
  }

  return <section className={styles.sharePanel} aria-labelledby="rehearsal-share-title">
    <div>
      <p>SHARE</p>
      <h2 id="rehearsal-share-title">稽古スケジュール共有</h2>
      <span>このURLを共有すると、ログインせずに最新の稽古予定を確認できます。</span>
    </div>
    {status === null ? <p className={styles.shareLoading}>共有状態を確認しています…</p> : status.enabled ? <div className={styles.shareControls}>
      <strong>共有中</strong>
      <button className={styles.sharePrimaryAction} type="button" disabled={busy} onClick={() => void copyUrl()}>共有URLをコピー</button>
      {canManage && <details className={styles.shareAuxiliary}>
        <summary>その他の操作</summary>
        <div className={styles.shareAuxiliaryActions}>
          <button type="button" disabled={busy} onClick={() => {
            if (window.confirm("共有URLを再発行しますか？\n\n再発行すると、現在の共有URLは使えなくなります。\nすでにURLを共有している場合は、新しいURLを改めて案内する必要があります。")) void update("PATCH");
          }}>URLを再発行</button>
          <button className={styles.shareStopButton} type="button" disabled={busy} onClick={() => {
            if (window.confirm("稽古スケジュールの共有を停止しますか？\n\n共有を停止すると、このURLから稽古予定を閲覧できなくなります。")) void update("DELETE");
          }}>共有を停止</button>
        </div>
      </details>}
    </div> : <div className={styles.shareControls}>
      <strong>未共有</strong>
      {canManage
        ? <button className={styles.sharePrimaryAction} type="button" disabled={busy} onClick={() => void update("POST")}>{busy ? "発行中…" : "共有リンクを発行"}</button>
        : <span className={styles.shareReadOnly}>共有リンクはまだ発行されていません。</span>}
    </div>}
    {message && <p className={styles.shareSuccess} role="status">{message}</p>}
    {error && <p className={styles.shareError} role="alert">{error}</p>}
  </section>;
}
