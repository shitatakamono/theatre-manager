"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";

import { auth } from "@/lib/firebase";
import { takeProjectInviteReturnPath } from "@/lib/project-invite-link-client";
import { PROJECT_INVITE_SESSION_KEY } from "@/lib/project-invite-link-client";

import styles from "./line-auth-complete.module.css";

type Status = "processing" | "signup" | "unlinked" | "error";
type SignupPreview = { projectName: string; displayName: string | null };

export function LineAuthCompleteClient() {
  const started = useRef(false);
  const returnPath = useRef<string | null>(null);
  const [visibleReturnPath, setVisibleReturnPath] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("processing");
  const [signupToken, setSignupToken] = useState("");
  const [signupPreview, setSignupPreview] = useState<SignupPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [signupError, setSignupError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    returnPath.current = takeProjectInviteReturnPath();
    void Promise.resolve().then(() => setVisibleReturnPath(returnPath.current));
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const result = query.get("result");
    const ticket = fragment.get("ticket") ?? "";
    const signup = fragment.get("signup") ?? "";
    window.history.replaceState(null, "", "/line/auth/complete");

    void (async () => {
      await Promise.resolve();
      if (result === "unlinked") {
        setStatus("unlinked");
        return;
      }
      if (result === "signup" && signup) {
        try {
          const response = await fetch("/api/line/auth/signup/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ signupToken: signup }),
          });
          const body = await response.json().catch(() => ({})) as { signup?: SignupPreview };
          if (!response.ok || !body.signup) throw new Error("invalid_signup");
          setSignupToken(signup);
          setSignupPreview(body.signup);
          setStatus("signup");
        } catch { setStatus("error"); }
        return;
      }
      if (result !== "ticket" || !ticket) {
        setStatus("error");
        return;
      }
      try {
        const response = await fetch("/api/line/auth/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket }),
        });
        const body = await response.json().catch(() => ({})) as { customToken?: unknown };
        if (!response.ok || typeof body.customToken !== "string" || !body.customToken) {
          throw new Error("exchange_failed");
        }
        await signInWithCustomToken(auth, body.customToken);
        window.location.replace(returnPath.current ?? "/projects");
      } catch {
        setStatus("error");
      }
    })();
  }, []);

  async function exchangeAndSignIn(ticket: string, projectId: string) {
    const exchange = await fetch("/api/line/auth/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket }),
    });
    const exchanged = await exchange.json().catch(() => ({})) as { customToken?: unknown };
    if (!exchange.ok || typeof exchanged.customToken !== "string" || !exchanged.customToken) {
      throw new Error("exchange_failed");
    }
    await signInWithCustomToken(auth, exchanged.customToken);
    try { sessionStorage.removeItem(PROJECT_INVITE_SESSION_KEY); } catch { /* no-op */ }
    window.location.replace(`/projects/${encodeURIComponent(projectId)}`);
  }

  async function createAccount() {
    if (!signupToken || submitting) return;
    setSubmitting(true);
    setSignupError("");
    try {
      const response = await fetch("/api/line/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signupToken }),
      });
      const body = await response.json().catch(() => ({})) as {
        ticket?: unknown; projectId?: unknown;
      };
      if (!response.ok || typeof body.ticket !== "string" || typeof body.projectId !== "string") {
        throw new Error("signup_failed");
      }
      await exchangeAndSignIn(body.ticket, body.projectId);
    } catch {
      setSignupError("新しいアカウントを作成できませんでした。時間をおいてもう一度お試しください。");
      setSubmitting(false);
    }
  }

  function useExistingAccount() {
    window.location.replace("/invite");
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>SEISAKU BOARD</p>
        <h1>LINEログイン</h1>
        {status === "processing" && <p role="status">ログインを完了しています…</p>}
        {status === "unlinked" && (
          <p role="alert">
            このLINEアカウントはまだSeisakuBoardに連携されていません。<br />
            既にSeisakuBoardを利用している方は、Googleでログイン後、個人設定からLINEを連携してください。
          </p>
        )}
        {status === "signup" && signupPreview && (
          <div className={styles.signup}>
            <h2>SeisakuBoardを初めて利用しますか？</h2>
            <p>このLINEアカウントはSeisakuBoardにまだ登録されていません。</p>
            <p><strong>{signupPreview.projectName}</strong>へ閲覧者として参加します。</p>
            <p className={styles.warning}>すでにGoogleでSeisakuBoardを利用したことがある場合は、新しいアカウントを作成しないでください。</p>
            <div className={styles.actions}>
              <button type="button" className={styles.secondary} disabled={submitting} onClick={useExistingAccount}>既存アカウントでログイン</button>
              <button type="button" disabled={submitting} onClick={() => void createAccount()}>{submitting ? "作成中…" : "LINEで新しいアカウントを作成"}</button>
            </div>
            {signupError && <p role="alert">{signupError}</p>}
            <small>新しいアカウントを作成すると、<Link href="/terms">利用規約</Link>と<Link href="/privacy">プライバシーポリシー</Link>に同意したものとみなされます。</small>
          </div>
        )}
        {status === "error" && (
          <p role="alert">LINEログインを完了できませんでした。もう一度お試しください。</p>
        )}
        {status !== "processing" && status !== "signup" && <Link href={visibleReturnPath ?? "/projects"}>{visibleReturnPath ? "招待ページへ戻る" : "ログイン画面へ戻る"}</Link>}
      </section>
    </main>
  );
}
