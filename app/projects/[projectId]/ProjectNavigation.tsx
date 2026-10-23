"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { buildProjectNavigation, isCurrentProjectNavigationItem } from "@/lib/project-navigation";
import { useProjectAccess } from "./ProjectAccess";
import styles from "./project-navigation.module.css";

export function ProjectNavigation({ projectId }: { projectId: string }) {
  const pathname = usePathname();
  const { role } = useProjectAccess();
  const [showHelp, setShowHelp] = useState(false);
  const groups = buildProjectNavigation(projectId, role);

  return <>
    <div className={styles.shell}>
      <div className={styles.bar}>
        <Link className={styles.brand} href="/">SeisakuBoard</Link>
        <nav className={styles.groups} aria-label="公演内ナビゲーション">
          {groups.map((group) => <details className={styles.group} key={group.label}>
            <summary>{group.label}<span aria-hidden="true">⌄</span></summary>
            <div className={styles.menu}>
              {group.items.map((item) => item.href ? <Link
                aria-current={isCurrentProjectNavigationItem(pathname, item.href) ? "page" : undefined}
                data-auxiliary={item.auxiliary || undefined}
                href={item.href}
                key={item.label}
              >{item.label}</Link> : <button type="button" onClick={() => setShowHelp(true)} key={item.label}>{item.label}</button>)}
            </div>
          </details>)}
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
