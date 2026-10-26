"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  buildProjectNavigation,
  isCurrentProjectPrimaryNavigationItem,
  isManagementMenuVisible,
  isCurrentProjectNavigationItem,
  reduceManagementMenuState,
} from "@/lib/project-navigation";
import styles from "./project-navigation.module.css";

export function ProjectNavigation({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const [showHelp, setShowHelp] = useState(false);
  const [managementOpen, setManagementOpen] = useState(false);
  const [managementPathname, setManagementPathname] = useState(pathname);
  const managementRef = useRef<HTMLDivElement>(null);
  const navigation = buildProjectNavigation(projectId);
  const managementVisible = isManagementMenuVisible(managementOpen, managementPathname, pathname);
  const managementCurrent = navigation.management.some((item) => item.href && isCurrentProjectNavigationItem(pathname, item.href));

  useEffect(() => {
    if (!managementVisible) return;
    const closeOutside = (event: PointerEvent) => {
      if (!managementRef.current?.contains(event.target as Node)) {
        setManagementOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setManagementOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [managementVisible]);

  const closeManagement = () => setManagementOpen((current) => reduceManagementMenuState(current, "close"));
  const toggleManagement = () => {
    if (managementPathname !== pathname) {
      setManagementPathname(pathname);
      setManagementOpen(true);
      return;
    }
    setManagementOpen((current) => reduceManagementMenuState(current, "toggle"));
  };

  return <>
    <div className={styles.shell}>
      <div className={styles.bar}>
        <Link className={styles.brand} href="/">SeisakuBoard</Link>
        <nav className={styles.groups} aria-label="公演内ナビゲーション">
          {navigation.primary.map((item) => <Link
            className={styles.directLink}
            aria-current={isCurrentProjectPrimaryNavigationItem(pathname, item.href) ? "page" : undefined}
            href={item.href}
            key={item.label}
            onClick={closeManagement}
          >{item.label}</Link>)}
          <div className={styles.management} ref={managementRef}>
            <button
              className={styles.managementButton}
              type="button"
              aria-expanded={managementVisible}
              aria-current={managementCurrent ? "page" : undefined}
              aria-haspopup="menu"
              onClick={toggleManagement}
            >管理<span aria-hidden="true">▼</span></button>
            {managementVisible && <div className={styles.menu} role="menu">
              {navigation.management.map((item) => item.href ? <Link
                aria-current={isCurrentProjectNavigationItem(pathname, item.href) ? "page" : undefined}
                href={item.href}
                key={item.label}
                onClick={closeManagement}
                role="menuitem"
              >{item.label}</Link> : <button type="button" onClick={() => { closeManagement(); setShowHelp(true); }} key={item.label} role="menuitem">{item.label}</button>)}
            </div>}
          </div>
        </nav>
        <Link className={styles.projectList} href="/">公演一覧</Link>
      </div>
    </div>

    {showHelp && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setShowHelp(false); }}>
      <section className={styles.help} role="dialog" aria-modal="true" aria-labelledby="project-help-title">
        <header><div><p>QUICK GUIDE</p><h2 id="project-help-title">SeisakuBoardの使い方</h2></div><button type="button" aria-label="閉じる" onClick={() => setShowHelp(false)}>×</button></header>
        <ol>
          <li><strong>公演情報を登録</strong><span>日時・会場・料金など、公演全体で使う情報を登録します。</span></li>
          <li><strong>稽古と出欠を共有</strong><span>稽古予定を確認し、それぞれの参加予定を入力します。</span></li>
          <li><strong>制作ロードマップを確認</strong><span>会場、広報、チケット、受付、会計の準備状況を進めます。</span></li>
          <li><strong>管理情報を確認</strong><span>システム利用者や更新履歴は「管理」から確認できます。</span></li>
        </ol>
      </section>
    </div>}
  </>;
}
