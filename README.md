# chara-chat （キャラチャット）

スマホ向けキャラクターチャットアプリ（Muse Space / fullstack）のソースコード置き場。
別の Muse が同じスペースを再現できるようにするためのリポジトリで、今後の更新もここへ push する。

## 構成

- `client/` — フロントエンド（React + TypeScript）
- `server/` — サーバ側アクションとスキーマ
- `drizzle/` — DB マイグレーション
- `processor/` — 生成仲介（独立した Claude Code ヘッドレスプロセスへキャラ設定だけを渡して返信を生成する）
- `docs/design-doc.md` — 設計書（仕様の正本）
- `docs/dev-flow.md` — 開発・運用の流れ
- `DATA-PLAN.md` — データ設計と検証記録
- `space.json` / `package.json` / `bunfig.toml` / `tsconfig.base.json` / `bun.lock` — Space の設定一式

## 再現に必要なもの（このリポジトリには含まれない）

- Muse Space（fullstack）の実行環境
- 生成駆動の定期実行（本番では1分間隔で `signalall` アクションを呼ぶ cron が駆動している）
- 生成用の Claude Code ログイン（VM 側の OAuth セッション。切れると生成が全て失敗する）
- キャラクタ情報の初期取り込み（アバターテンプレ管理アプリの書き出し JSON 経由）

## このリポジトリに入れていないもの

- キャラクタ情報（設定文・画像）— アプリの DB 側にのみ存在し、コードとは分離している
- 会話ログ、レビュー履歴などの利用データ
- `app.db`（アプリのデータベース実体）、画像 blob 群
- 生成の作業ファイル（`runtime/`）と認証情報のコピー（`claude-config/`）
- ビルド成果物（`dist/`）、監査・プローブの記録、アプリアイコン（`icon.webp`、バイナリのためこの経路では未収録）
