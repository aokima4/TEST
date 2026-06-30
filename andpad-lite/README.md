# 施工管理アプリ（MVP）

ANDPAD を参考にした施工管理アプリの MVP。案件管理・工程表・写真共有の3機能を実装。

## スタック

- Next.js 16 (App Router, TypeScript, Tailwind CSS)
- Supabase (PostgreSQL / Auth / Storage)

## セットアップ

1. Supabase プロジェクトを作成
2. SQL Editor で `supabase/schema.sql` を実行（テーブル・RLS・ストレージバケットを作成）
3. Authentication > Providers で Email を有効化（開発中は「Confirm email」をオフにすると検証しやすい）
4. `.env.local.example` を `.env.local` にコピーし、Supabase の URL と anon key を設定
5. `npm install`
6. `npm run dev`

## 機能

- **認証**: メール/パスワードでサインアップ（元請 / 協力会社のロール選択）
- **案件管理**: 案件の作成・一覧・詳細（住所、施主、工期）
- **メンバー管理**: 案件オーナー（元請）が表示名検索で協力会社を案件に追加
- **工程表**: 案件ごとにタスク（工程）を追加し、担当者・期間・ステータスを管理
- **写真共有**: 案件・工程に紐づけて写真をアップロードし、ギャラリー表示（Supabase Storage の署名付きURLで配信）

## 今後の拡張候補

- 図面への是正指示・電子黒板機能
- ガントチャート形式の工程表ビュー
- チャット機能
- 受発注・原価管理
