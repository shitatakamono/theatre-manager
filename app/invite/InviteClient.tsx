"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useAuth } from "@/app/AuthProvider";
import { auth } from "@/lib/firebase";
import {
  PROJECT_INVITE_SESSION_KEY,
  storeProjectInviteForAuthentication,
} from "@/lib/project-invite-link-client";
import { isValidProjectInviteLinkToken } from "@/lib/project-invite-links";

import styles from "./invite.module.css";

type Preview = {
  projectName: string;
  role: "viewer";
  expiresAt: string;
  status: "pending" | "claimed" | "revoked" | "expired";
};

const STATUS_MESSAGES: Record<Exclude<Preview["status"], "pending">, string> = {
  claimed: "この招待リンクは使用済みです。",
  revoked: "この招待リンクは無効です。",
  expired: "この招待リンクの有効期限が切れています。",
};

function getToken(): string {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const fromUrl = fragment.get("token") ?? "";
  if (isValidProjectInviteLinkToken(fromUrl)) {
    storeProjectInviteForAuthentication(fromUrl);
    window.history.replaceState(null, "", "/invite");
    return fromUrl;
  }
  try {
    const stored = sessionStorage.getItem(PROJECT_INVITE_SESSION_KEY) ?? "";
    return isValidProjectInviteLinkToken(stored) ? stored : "";
  } catch { return ""; }
}

export function InviteClient() {
  const { profile, login, loginWithLine, loginError } = useAuth();
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const rawToken = getToken();
    if (!rawToken) {
      void Promise.resolve().then(() => { setError("招待リンクを確認できませんでした。"); setLoading(false); });
      return;
    }
    void fetch("/api/project-invite-links/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken }), cache: "no-store",
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { invite?: Preview };
      if (!response.ok || !body.invite) throw new Error("invalid_invite");
      setToken(rawToken);
      setPreview(body.invite);
    }).catch(() => setError("招待リンクを確認できませんでした。"))
      .finally(() => setLoading(false));
  }, []);

  async function claim() {
    const user = auth.currentUser;
    if (!user || !token || claiming) return;
    setClaiming(true); setError("");
    try {
      const response = await fetch("/api/project-invite-links/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ token }),
      });
      const body = await response.json().catch(() => ({})) as { projectId?: unknown; error?: unknown };
      if (!response.ok || typeof body.projectId !== "string") {
        throw new Error(typeof body.error === "string" ? body.error : "招待を受けられませんでした");
      }
      try { sessionStorage.removeItem(PROJECT_INVITE_SESSION_KEY); } catch { /* no-op */ }
      window.location.replace(`/projects/${encodeURIComponent(body.projectId)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "招待を受けられませんでした");
      setClaiming(false);
    }
  }

  async function startLineLogin() {
    if (token) storeProjectInviteForAuthentication(token);
    await loginWithLine(token);
  }

  if (loading) return <main className={styles.page}><section className={styles.card}><p role="status">招待情報を確認しています…</p></section></main>;
  return <main className={styles.page}><section className={styles.card}>
    <p className={styles.eyebrow}>SEISAKU BOARD</p><h1>公演への招待</h1>
    {preview && <div className={styles.details}><strong>{preview.projectName}</strong><span>権限：閲覧者</span><span>有効期限：{new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(preview.expiresAt))}</span></div>}
    {preview?.status !== "pending" && preview && <p className={styles.error} role="alert">{STATUS_MESSAGES[preview.status]}</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {loginError && <p className={styles.error} role="alert">{loginError}</p>}
    {preview?.status === "pending" && !profile && <div className={styles.actions}>
      <p>SeisakuBoardへログインして招待を受けてください。</p>
      <button type="button" onClick={() => void login()}>Googleでログイン</button>
      <button type="button" data-line onClick={() => void startLineLogin()}>LINEでログイン</button>
      <small>初めて利用する方も、有効な招待からLINEだけで登録できます。</small>
    </div>}
    {preview?.status === "pending" && profile && <div className={styles.actions}><p>{profile.displayName || profile.email || "ログイン中のアカウント"}で参加します。</p><button type="button" disabled={claiming} onClick={() => void claim()}>{claiming ? "参加処理中…" : "この公演に参加"}</button></div>}
    <Link href="/projects">SeisakuBoardへ戻る</Link>
  </section></main>;
}
