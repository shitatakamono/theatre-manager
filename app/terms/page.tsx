import type { Metadata } from "next";
import { PublicSiteFooter, PublicSiteHeader } from "@/app/PublicSiteChrome";
import styles from "@/app/public-site.module.css";

export const metadata: Metadata = {
  title: "利用規約",
  description: "SeisakuBoardの利用条件、禁止事項、Googleカレンダー連携等について定める利用規約です。",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return (
    <div className={styles.siteShell}>
      <PublicSiteHeader />
      <main className={styles.legalMain}>
        <header className={styles.legalHeader}>
          <p className={styles.eyebrow}>TERMS OF SERVICE</p>
          <h1>利用規約</h1>
          <p>本規約は、劇団カレーライス合同会社（以下「当社」）が提供するSeisakuBoardの利用条件を定めるものです。</p>
        </header>
        <div className={styles.legalBody}>
          <section><h2>1. 適用</h2><p>本規約は、本サービスを利用するすべての方に適用されます。利用者は、本規約および当社が別途定めるルールに同意したうえで本サービスを利用するものとします。</p></section>
          <section><h2>2. アカウントと権限</h2><p>利用者は、自己の責任で認証アカウントを管理し、第三者に利用させてはなりません。公演ごとの閲覧・編集権限は、Owner、Editor、Viewer等の設定に従います。</p></section>
          <section><h2>3. 本サービスの利用</h2><p>利用者は、公演制作に必要な範囲で、稽古、出欠、タスク、関係者その他の情報を登録・共有できます。入力情報の正確性、適法性およびチーム内共有に必要な権限は、利用者または利用組織が確認するものとします。</p></section>
          <section><h2>4. Googleカレンダー連携</h2><p>利用者が連携を許可した場合、本サービスは専用のGoogleカレンダーを作成し、SeisakuBoardを正本として稽古予定を同期します。同期処理には遅延または一時的な失敗が生じる場合があります。Googleカレンダー上の予定だけを唯一の記録とせず、重要な情報は本サービス上でも確認してください。</p></section>
          <section><h2>5. 禁止事項</h2><ul><li>法令、公序良俗または第三者の権利に違反する行為</li><li>不正アクセス、認証情報の不正利用、システムへの過度な負荷その他運用を妨害する行為</li><li>他人になりすます行為、権限なく個人情報や秘密情報を登録・共有する行為</li><li>本サービスの解析、改変、転売その他当社が不適切と判断する行為</li></ul></section>
          <section><h2>6. サービスの変更・停止</h2><p>当社は、保守、障害、外部サービスの停止その他必要がある場合、本サービスの全部または一部を変更・中断・終了できるものとします。可能な場合は事前にお知らせします。</p></section>
          <section><h2>7. 知的財産権</h2><p>本サービスのプログラム、デザイン、名称その他の権利は当社または正当な権利者に帰属します。利用者が入力した情報の権利は利用者または正当な権利者に留保されます。</p></section>
          <section><h2>8. 免責と責任の制限</h2><p>当社は、本サービスの完全性、正確性、継続性または特定目的への適合性を保証しません。当社の故意または重過失による場合を除き、本サービスの利用または利用不能から生じた損害について、法令上許される範囲で責任を負いません。</p></section>
          <section><h2>9. 利用停止</h2><p>利用者が本規約に違反した場合、当社は事前の通知なく利用を制限または停止できるものとします。利用終了後も、性質上存続すべき条項は有効に存続します。</p></section>
          <section><h2>10. 準拠法と協議</h2><p>本規約は日本法に準拠します。本サービスに関する紛争が生じた場合、当社と利用者は誠実に協議して解決を図るものとします。</p></section>
          <section><h2>11. お問い合わせ</h2><p>運営者：劇団カレーライス合同会社</p><p>メール：<a className={styles.contactLink} href="mailto:seisakuboard@geki-curry.com">seisakuboard@geki-curry.com</a></p></section>
          <section><h2>12. 規約の変更</h2><p>当社は、必要に応じて本規約を変更できます。重要な変更は、本サービス上その他適切な方法でお知らせします。</p><p>制定日：2026年11月2日</p></section>
        </div>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
