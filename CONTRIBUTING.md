# Contributing

**English** · [日本語](#コントリビューション)

Thank you for your interest in Scurrop.

- **Bugs and requests**: open an [issue](../../issues). Include the version ("Scurrop v…" at the bottom of Settings) and the steps to reproduce.
- **Pull requests**: for larger changes, please open an issue first to discuss the direction. Small fixes can be sent directly.
- **Translations**: improvements to the English UI text are welcome. It has not been reviewed by a native speaker. French, Spanish and Traditional Chinese translations are included in `i18n/` but are disabled until they are reviewed. Reviews are welcome too.
- **Security**: do not use issues. See [SECURITY.md](SECURITY.md).

Scurrop is maintained in limited time, so replies may take a few days.

## Development

- UI text: edit `i18n/en.json`, then run `node tools/i18n-build.js` to regenerate `src/I18n.gs`.
- Tests: `node test/logic.test.js` (no dependencies). Please run it before sending a pull request.
- The app itself is `src/Code.gs` (server) and `src/index.html` (screen). It makes no requests to servers other than Google's. Please keep it that way.

---

# コントリビューション

Scurropに関心を持っていただき、ありがとうございます。

- **不具合・要望**: [Issue](../../issues)を作成してください。バージョン（「設定」の最下部の「Scurrop v…」）と再現手順を記載してください。
- **プルリクエスト**: 大きな変更は、先にIssueで方針を相談してください。小さな修正は、そのまま送っていただいてかまいません。
- **翻訳**: 英語の表示文言の改善を歓迎します。ネイティブによる確認が済んでいません。フランス語・スペイン語・繁體中文の訳も`i18n/`に含まれていますが、確認が済むまで無効にしています。確認の協力も歓迎します。
- **セキュリティ**: Issueには記載しないでください。[SECURITY.md](SECURITY.md)を参照してください。

限られた時間で保守しているため、返信に数日かかる場合があります。

## 開発

- 表示文言: `i18n/en.json`を編集し、`node tools/i18n-build.js`で`src/I18n.gs`を再生成します。
- テスト: `node test/logic.test.js`（依存なし）。プルリクエストの前に実行してください。
- アプリ本体は、`src/Code.gs`（サーバー側）と`src/index.html`（画面）です。Google以外のサーバーへの通信は行いません。この方針を維持してください。
