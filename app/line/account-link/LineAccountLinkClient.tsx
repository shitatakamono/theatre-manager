"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/app/AuthProvider";
import { auth } from "@/lib/firebase";
import { requireLineLinkToken } from "@/lib/line-account-link-authorize";
import styles from "./line-account-link.module.css";

const LINK_TOKEN_SESSION_KEY = "seisakuboard.lineAccountLinkToken";

type AuthorizeResponse = {
  redirectUrl?: string;
};

function readValidLinkToken(value: string | null): string | null {
  try {
    return requireLineLinkToken(value);
  } catch {
    return null;
  }
}

export default function LineAccountLinkClient() {
  const searchParams = useSearchParams();
  const { loading, profile, login, loginError } = useAuth();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const queryToken = readValidLinkToken(searchParams.get("linkToken"));
    if (queryToken) {
      sessionStorage.setItem(LINK_TOKEN_SESSION_KEY, queryToken);
      window.history.replaceState(null, "", "/line/account-link");
    }
    const storedToken = queryToken
      ?? readValidLinkToken(sessionStorage.getItem(LINK_TOKEN_SESSION_KEY));
    queueMicrotask(() => {
      if (!active) return;
      setLinkToken(storedToken);
      setReady(true);
    });
    return () => { active = false; };
  }, [searchParams]);

  async function authorize() {
    const user = auth.currentUser;
    if (!user || !linkToken) {
      setError("LINE連携を開始できませんでした。LINEのトーク画面からもう一度「連携」と送ってください。");
      return;
    }
    setProcessing(true);
    setError("");
    try {
      const response = await fetch("/api/line/account-link/authorize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await user.getIdToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ linkToken }),
      });
      const body = await response.json().catch(() => ({})) as AuthorizeResponse;
      if (!response.ok || typeof body.redirectUrl !== "string") throw new Error("authorize_failed");
      const redirect = new URL(body.redirectUrl);
      if (redirect.origin !== "https://access.line.me") throw new Error("invalid_redirect");
      sessionStorage.removeItem(LINK_TOKEN_SESSION_KEY);
      window.location.assign(redirect.toString());
    } catch {
      setError("LINE連携を開始できませんでした。LINEのトーク画面からもう一度「連携」と送ってください。");
      setProcessing(false);
    }
  }

  function cancel() {
    sessionStorage.removeItem(LINK_TOKEN_SESSION_KEY);
    setLinkToken(null);
  }

  const missingToken = ready && !linkToken;

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>LINE INTEGRATION</p>
        <h1>LINE連携</h1>
        <p className={styles.description}>
          SeisakuBoardとLINEを連携します。連携すると、稽古予定や変更のお知らせなどをLINEで受け取れるようになります。
        </p>

        {!ready || loading ? <p className={styles.status}>連携情報を確認しています…</p> : null}

        {missingToken ? (
          <p className={styles.error} role="alert">
            LINE連携情報を確認できませんでした。LINEのトーク画面からもう一度「連携」と送ってください。
          </p>
        ) : null}

        {ready && linkToken && !loading ? (
          <div className={styles.actions}>
            {profile ? (
              <button type="button" disabled={processing} onClick={() => void authorize()}>
                {processing ? "連携を開始しています…" : "LINEと連携する"}
              </button>
            ) : (
              <button type="button" disabled={processing} onClick={() => void login()}>
                Googleでログインして連携する
              </button>
            )}
            <Link href="/" onClick={cancel}>連携をキャンセル</Link>
          </div>
        ) : null}

        {(error || loginError) ? <p className={styles.error} role="alert">{error || loginError}</p> : null}
      </section>
    </main>
  );
}
