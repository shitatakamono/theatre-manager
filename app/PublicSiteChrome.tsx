import Link from "next/link";
import styles from "./public-site.module.css";

export function PublicSiteHeader() {
  return (
    <header className={styles.publicHeader}>
      <div className={styles.headerInner}>
        <Link className={styles.brand} href="/" aria-label="SeisakuBoard トップ">
          <span>SEISAKU BOARD</span>
          <strong>SeisakuBoard</strong>
        </Link>
        <nav className={styles.publicNav} aria-label="公開ページナビゲーション">
          <Link href="/privacy">プライバシー</Link>
          <Link href="/terms">利用規約</Link>
          <Link className={styles.navAction} href="/projects">ログイン／アプリへ</Link>
        </nav>
      </div>
    </header>
  );
}

export function PublicSiteFooter() {
  return (
    <footer className={styles.publicFooter}>
      <div className={styles.footerInner}>
        <div>
          <strong>SeisakuBoard</strong>
          <p>運営：劇団カレーライス合同会社</p>
          <p><a href="mailto:seisakuboard@geki-curry.com">seisakuboard@geki-curry.com</a></p>
        </div>
        <nav aria-label="フッターナビゲーション">
          <Link href="/privacy">プライバシーポリシー</Link>
          <Link href="/terms">利用規約</Link>
          <Link href="/projects">ログイン／アプリへ</Link>
        </nav>
        <small>© 2026 Gekidan Curry Rice LLC</small>
      </div>
    </footer>
  );
}
