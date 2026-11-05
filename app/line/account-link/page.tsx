import type { Metadata } from "next";
import { Suspense } from "react";
import LineAccountLinkClient from "./LineAccountLinkClient";
import styles from "./line-account-link.module.css";

export const metadata: Metadata = {
  title: "LINE連携",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function LineAccountLinkPage() {
  return (
    <Suspense fallback={<main className={styles.page}><p>連携情報を確認しています…</p></main>}>
      <LineAccountLinkClient />
    </Suspense>
  );
}
