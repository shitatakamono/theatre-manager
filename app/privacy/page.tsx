import type { Metadata } from "next";
import { PublicSiteFooter, PublicSiteHeader } from "@/app/PublicSiteChrome";
import styles from "@/app/public-site.module.css";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  description: "SeisakuBoardにおける利用者情報、Googleカレンダー連携情報等の取扱いについて説明します。",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <div className={styles.siteShell}>
      <PublicSiteHeader />
      <main className={styles.legalMain}>
        <header className={styles.legalHeader}>
          <p className={styles.eyebrow}>PRIVACY POLICY</p>
          <h1>プライバシーポリシー</h1>
          <p>劇団カレーライス合同会社（以下「当社」）は、SeisakuBoardの提供にあたり取得する情報を、以下の方針に基づき取り扱います。</p>
        </header>
        <div className={styles.legalBody}>
          <section><h2>1. 取得する情報</h2><ul><li>Googleアカウント等による認証情報（ユーザー識別子、氏名、メールアドレス、プロフィール画像）</li><li>公演、稽古、出欠、制作タスク、関係者、権限、活動履歴等、利用者が本サービスへ入力する情報</li><li>Googleカレンダー連携に必要な認可情報、連携状態、専用カレンダーおよび同期対象イベントの管理情報</li><li>不具合調査や安全な運用に必要なアクセス情報、エラー情報およびお問い合わせ内容</li></ul></section>
          <section><h2>2. 利用目的</h2><ul><li>本サービスの認証、提供、保守および改善</li><li>公演制作チーム内での情報共有、権限管理、通知およびGoogleカレンダー同期</li><li>不正利用の防止、障害対応、利用者からのお問い合わせ対応</li><li>個人を識別できない形での利用状況の分析</li></ul></section>
          <section><h2>3. Googleカレンダー連携</h2><p>本サービスは、利用者の明示的な認可に基づき、SeisakuBoard専用のセカンダリカレンダーを作成し、対象となる稽古予定を追加、更新または削除します。primaryカレンダーは同期先として使用しません。Googleカレンダー上の変更をSeisakuBoardへ取り込む逆同期は行いません。</p><p>Googleから発行されたrefresh tokenはサーバー側でAES-256-GCM方式により暗号化して保存し、クライアントへ返しません。連携解除時は保存済みrefresh tokenを削除します。Google APIから取得した情報の利用および他のアプリへの転送には、Google API Services User Data Policy（Limited Use要件を含みます）が適用されます。</p></section>
          <section><h2>4. 外部サービスと保存基盤</h2><p>当社は、認証、データ保存、ホスティング、メール送信およびGoogleカレンダー連携のため、Google Firebase / Google Cloud、Google Calendar API、Vercel、Resend等の外部サービスを利用します。各サービスにおける情報の取扱いには、各提供者の規約およびプライバシーポリシーが適用されます。</p></section>
          <section><h2>5. 第三者提供</h2><p>当社は、法令に基づく場合、利用者の同意がある場合、または本サービスの提供に必要な業務委託先へ必要最小限の情報を取り扱わせる場合を除き、個人情報を第三者へ提供しません。</p></section>
          <section><h2>6. 安全管理</h2><p>当社は、アクセス制御、暗号化、認証情報のサーバー側管理、操作履歴および必要最小限の権限付与等、情報の漏えい、滅失または毀損を防ぐための合理的な安全管理措置を講じます。</p></section>
          <section><h2>7. 保存期間と削除</h2><p>取得した情報は、利用目的の達成および法令・紛争対応に必要な期間保存します。Googleカレンダー連携は個人設定から解除できます。サービス内データの開示、訂正または削除に関するご相談は、下記窓口へご連絡ください。</p></section>
          <section><h2>8. お問い合わせ</h2><p>運営者：劇団カレーライス合同会社</p><p>メール：<a className={styles.contactLink} href="mailto:seisakuboard@geki-curry.com">seisakuboard@geki-curry.com</a></p></section>
          <section><h2>9. 改定</h2><p>当社は、法令やサービス内容の変更に応じて本ポリシーを改定することがあります。重要な変更は、本サービス上その他適切な方法でお知らせします。</p><p>制定日：2026年11月2日</p></section>
        </div>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
