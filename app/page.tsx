import Link from "next/link";
import { PublicSiteFooter, PublicSiteHeader } from "./PublicSiteChrome";
import styles from "./public-site.module.css";

const FEATURES = [
  ["稽古と出欠を一元管理", "稽古日程、自分の出欠、チーム全体の回答状況を同じ公演内で確認できます。"],
  ["制作タスクを見える化", "担当者や期限を共有し、公演準備の抜け漏れを減らします。"],
  ["関係者情報を安全に整理", "キャスト、スタッフ、出欠対象者とシステム利用者の関係を明確に管理します。"],
  ["Googleカレンダー連携", "対象となる稽古予定を、利用者ごとの専用カレンダーへ同期できます。"],
] as const;

export default function HomePage() {
  return (
    <div className={styles.siteShell}>
      <PublicSiteHeader />
      <main>
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <p className={styles.eyebrow}>FOR THEATRE PRODUCTION TEAMS</p>
            <h1>公演づくりを、<br />ひとつの場所で。</h1>
            <p className={styles.lead}>SeisakuBoardは、舞台・公演制作に必要な稽古、出欠、タスク、関係者情報をチームで共有するための管理ツールです。</p>
            <div className={styles.heroActions}>
              <Link className={styles.primaryAction} href="/projects">ログイン／アプリを開く</Link>
              <a className={styles.secondaryAction} href="#features">できることを見る</a>
            </div>
          </div>
        </section>

        <section className={styles.section} id="features">
          <div className={styles.sectionHeading}>
            <p className={styles.eyebrow}>FEATURES</p>
            <h2>制作チームの日々の情報を整理</h2>
          </div>
          <div className={styles.featureGrid}>
            {FEATURES.map(([title, description]) => (
              <article className={styles.feature} key={title}>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.operatorSection}>
          <div>
            <p className={styles.eyebrow}>OPERATOR</p>
            <h2>劇団カレーライス合同会社</h2>
          </div>
          <p>舞台制作の現場で必要な情報を、関係者が迷わず確認できる仕組みづくりを進めています。</p>
        </section>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
