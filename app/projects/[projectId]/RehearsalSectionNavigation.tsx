"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buildRehearsalSectionNavigation } from "@/lib/project-navigation";
import styles from "./rehearsal-section-navigation.module.css";

export function RehearsalSectionNavigation({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  return <nav className={styles.navigation} aria-label="稽古と出欠">
    {buildRehearsalSectionNavigation(projectId).map((item) => <Link
      aria-current={pathname === item.href ? "page" : undefined}
      href={item.href}
      key={item.href}
    >{item.label}</Link>)}
  </nav>;
}
