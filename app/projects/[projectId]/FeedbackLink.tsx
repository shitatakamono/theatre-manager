"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./feedback-link.module.css";

export function FeedbackLink({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  if (pathname === `/projects/${projectId}/feedback`) return null;

  return (
    <Link
      aria-label="フィードバックを送る"
      className={styles.link}
      href={{ pathname: `/projects/${projectId}/feedback`, query: { from: pathname } }}
    >
      <span className={styles.desktopLabel}>フィードバック</span>
      <span className={styles.mobileLabel}>問題を報告</span>
    </Link>
  );
}
