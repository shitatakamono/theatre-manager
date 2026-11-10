"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";

import { auth } from "@/lib/firebase";
import { takeProjectInviteReturnPath } from "@/lib/project-invite-link-client";

import styles from "./line-auth-complete.module.css";

type Status = "processing" | "unlinked" | "error";

export function LineAuthCompleteClient() {
  const started = useRef(false);
  const returnPath = useRef<string | null>(null);
  const [visibleReturnPath, setVisibleReturnPath] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("processing");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    returnPath.current = takeProjectInviteReturnPath();
    void Promise.resolve().then(() => setVisibleReturnPath(returnPath.current));
    const query = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const result = query.get("result");
    const ticket = fragment.get("ticket") ?? "";
    window.history.replaceState(null, "", "/line/auth/complete");

    void (async () => {
      await Promise.resolve();
      if (result === "unlinked") {
        setStatus("unlinked");
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
        {status === "error" && (
          <p role="alert">LINEログインを完了できませんでした。もう一度お試しください。</p>
        )}
        {status !== "processing" && <Link href={visibleReturnPath ?? "/projects"}>{visibleReturnPath ? "招待ページへ戻る" : "ログイン画面へ戻る"}</Link>}
      </section>
    </main>
  );
}
