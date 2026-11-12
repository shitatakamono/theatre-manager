"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";

import { auth } from "@/lib/firebase";
import { takeProjectInviteReturnPath } from "@/lib/project-invite-link-client";
import { PROJECT_INVITE_SESSION_KEY } from "@/lib/project-invite-link-client";

import styles from "./line-auth-complete.module.css";

type Status =
  | "processing"
  | "signup"
  | "unlinked"
  | "invite_expired"
  | "invite_revoked"
  | "invite_used"
  | "invite_unavailable"
  | "error";
type SignupPreview = {
  projectName: string;
  displayName: string | null;
  personName: string | null;
  existingAccountRequired: boolean;
};

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
      if (
        result === "invite_expired"
        || result === "invite_revoked"
        || result === "invite_used"
        || result === "invite_unavailable"
      ) {
        setStatus(result);
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
        ticket?: unknown; projectId?: unknown; error?: unknown;
      };
      if (!response.ok || typeof body.ticket !== "string" || typeof body.projectId !== "string") {
        throw new Error(typeof body.error === "string" ? body.error : "signup_failed");
      }
      await exchangeAndSignIn(body.ticket, body.projectId);
    } catch (error) {
      setSignupError(error instanceof Error && error.message !== "signup_failed"
        ? error.message
        : "公演への参加を完了できませんでした。時間をおいてもう一度お試しください。");
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
            以前Googleで利用していた方は、同じGoogleアカウントで本人確認後、個人設定からLINEを連携してください。
          </p>
        )}
        {status === "invite_expired" && (
          <p role="alert">この招待の有効期限が切れています。招待した方に新しいリンクを発行してもらってください。</p>
        )}
        {status === "invite_revoked" && (
          <p role="alert">この招待は無効になっています。招待した方に新しいリンクを発行してもらってください。</p>
        )}
        {status === "invite_used" && (
          <p role="alert">この招待はすでに使用されています。</p>
        )}
        {status === "invite_unavailable" && (
          <p role="alert">招待情報を確認できませんでした。招待した方に新しいリンクを発行してもらってください。</p>
        )}
        {status === "signup" && signupPreview && (
          <div className={styles.signup}>
            {signupPreview.personName ? (
              <>
                <h2>公演への参加を確認</h2>
                <p><strong>{signupPreview.personName}</strong>さんとして、<strong>{signupPreview.projectName}</strong>へ参加します。</p>
                {signupPreview.existingAccountRequired ? (
                  <>
                    <p className={styles.warning}>この関係者情報はすでにSeisakuBoardで利用されています。以前利用していたGoogleアカウントで本人確認してから参加してください。</p>
                    <div className={styles.actions}>
                      <button type="button" disabled={submitting} onClick={useExistingAccount}>以前のGoogleアカウントで本人確認する</button>
                    </div>
                  </>
                ) : (
                  <div className={styles.actions}>
                    <button type="button" disabled={submitting} onClick={() => void createAccount()}>{submitting ? "参加処理中…" : "この公演に参加する"}</button>
                  </div>
                )}
              </>
            ) : (
              <>
                <h2>SeisakuBoardを初めて利用しますか？</h2>
                <p>このLINEアカウントはSeisakuBoardにまだ登録されていません。</p>
                <p><strong>{signupPreview.projectName}</strong>へ閲覧者として参加します。</p>
                <p className={styles.warning}>以前GoogleでSeisakuBoardを利用していた方は、同じGoogleアカウントで本人確認してください。</p>
                <div className={styles.actions}>
                  <button type="button" className={styles.secondary} disabled={submitting} onClick={useExistingAccount}>以前Googleで利用していた方</button>
                  <button type="button" disabled={submitting} onClick={() => void createAccount()}>{submitting ? "参加処理中…" : "LINEでこの公演に参加"}</button>
                </div>
              </>
            )}
            {signupError && <p role="alert">{signupError}</p>}
            {!signupPreview.existingAccountRequired && <small>公演へ参加すると、<Link href="/terms">利用規約</Link>と<Link href="/privacy">プライバシーポリシー</Link>に同意したものとみなされます。</small>}
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
