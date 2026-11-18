# Security

**English** · [日本語](#セキュリティ)

## Reporting a vulnerability

Please do not open a public issue. Report privately from the **Security** tab of this repository → "Report a vulnerability". If that button is not shown, email [info@hamnism.com](mailto:info@hamnism.com).

These details help:

- What becomes possible (for example, a person who is not registered can read tasks)
- Steps to reproduce
- The version you tested ("Scurrop v…" at the bottom of Settings)

Only the latest version is supported.

## Security model

- Scurrop runs entirely inside the Google account of the person who installed it: a spreadsheet and the Apps Script attached to it. There is no server operated by the developer, and no data is sent to the developer.
- Anyone who knows the web app URL can open it. Data is returned only to registered members.
- Members in the same Google Workspace organization are identified by their Google account. Members outside the organization use a personal link with a key. **Anyone who has that link can open Scurrop as that member.** If a link is leaked, an admin can invalidate it from Members → Edit → Reissue.
- Admin operations are allowed only for admins identified by their Google account.
- Anyone who can edit the spreadsheet can read and change all data, including member roles. The person who installed Scurrop decides who the spreadsheet is shared with.

See "Access and permissions" in the [README](README.md#access-and-permissions).

---

# セキュリティ

## 脆弱性の報告

公開のIssueには記載せず、このリポジトリの**Security**タブ →「Report a vulnerability」から非公開で報告してください。このボタンが表示されない場合は、[info@hamnism.com](mailto:info@hamnism.com)にメールでお知らせください。

次の情報があると、対応が早くなります。

- 何が可能になるか（例: 登録されていない人がタスクを閲覧できる）
- 再現手順
- 確認したバージョン（「設定」の最下部の「Scurrop v…」）

対応の対象は、最新のバージョンです。

## セキュリティの前提

- Scurropは、導入した人のGoogleアカウントの中だけで動作します（スプレッドシートと、それに付属するApps Script）。開発元が運用するサーバーはなく、データは開発元に送信されません。
- ウェブアプリのURLは、知っていれば誰でも開けます。データを返すのは、登録されたメンバーに対してのみです。
- 同じGoogle Workspaceの組織のメンバーは、Googleアカウントで判別します。組織外のメンバーは、本人専用の鍵つきリンクを使用します。**鍵つきリンクを知っている人は、そのメンバーとして開けます**。リンクが漏れた場合は、管理者が「メンバー」→「変更」→「再発行」で無効にできます。
- 管理者の操作は、Googleアカウントで判別できた管理者だけに許可されます。
- スプレッドシートを編集できる人は、メンバーのロールを含む全データを閲覧・変更できます。共有の範囲は、導入した人が決定します。

詳細は[README](README.ja.md#アクセスと権限)の「アクセスと権限」を参照してください。
