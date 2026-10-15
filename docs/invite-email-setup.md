# 招待メール送信の設定

## 1. Resendと送信ドメイン

1. Resendでアカウントを作成する。
2. `gekidan-curryrice.com` またはメール送信用サブドメインを追加する。
3. Resendが提示するSPF（TXT）とDKIM（TXT/CNAME）をDNSへ追加する。既存のMX、SPF、DKIM、DMARCを削除・上書きせず、DNS事業者とResendの案内に従って共存させる。
4. Resend上でドメインがVerifiedになったことを確認し、そのドメインの送信元を `INVITE_EMAIL_FROM` に設定する。

DNS変更はこのリポジトリやFirebase/Vercelのdeployでは行われない。

## 2. 必要な環境変数

`.env.example` に記載した次の変数を設定する。秘密値はGitへ追加しない。

- `RESEND_API_KEY`: Resend API key（サーバー専用。`NEXT_PUBLIC_` を付けない）
- `INVITE_EMAIL_FROM`: 例 `SeisakuBoard <seisakuboard@example.com>`
- `INVITE_EMAIL_REPLY_TO`: 任意の返信先
- `NEXT_PUBLIC_APP_URL`: localhostでは `http://localhost:3000`、本番ではVercelのProduction URL
- `FIREBASE_ADMIN_PROJECT_ID`: Firebase project ID
- `FIREBASE_ADMIN_CLIENT_EMAIL`: サービスアカウントのclient email
- `FIREBASE_ADMIN_PRIVATE_KEY`: サービスアカウントのprivate key。Vercelでは改行を `\n` として登録可能

FirebaseサービスアカウントJSONファイルはリポジトリへ配置しない。ローカルでApplication Default Credentialsを使用する場合は、Firebase Admin SDKが参照できる認証を別途設定できる。

## 3. localhost

1. `.env.local` に上記変数を設定する。
2. `npm run dev` で起動する。
3. Ownerでメンバー画面を開き、自分が受信できるテスト用GoogleアカウントをEditorまたはViewerとして招待する。
4. 送信成功表示、受信メールの本文・リンク、招待一覧の「メール送信済み」を確認する。
5. 同じ招待の再送は60秒以上空けて確認する。

## 4. Vercel

Vercel Project SettingsのEnvironment Variablesへ上記変数を登録する。少なくともProductionへ設定し、Previewで試す場合はPreviewにも個別に設定する。変更後は新しいdeploymentが必要になる。

## 5. 本番確認

1. Firebase AdminとResendの環境変数がProductionへ設定済みであることを確認する。
2. Ownerから管理対象のテスト用メールアドレスへ招待する。
3. メール受信、Googleアカウント一致案内、トップURL、ログイン後の自動claimを確認する。
4. Editor/Viewerから送信APIを呼べないこと、accepted/revoked招待を再送できないことを確認する。
5. 失敗時にinviteがpendingのまま残り、一覧から再送できることを確認する。

自動テストはResendをmockし、実メールを送信しない。
