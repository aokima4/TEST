# エステサロン開業まるごとパック｜LP

エステサロン開業支援サービスのランディングページです。

## ファイル構成

```
esthetic-salon-lp/
├── index.html   … LP本体（HTML / CSS / JS すべて1ファイル）
├── assets/      … 画像を置くフォルダ（現在は空）
└── README.md    … このファイル
```

## 使い方

`index.html` をブラウザで開くだけで表示できます。
公開するときは、このフォルダごとサーバーにアップロードしてください。

## 本番公開前に差し替えが必要な箇所

| 場所 | 内容 |
|---|---|
| `<link rel="canonical">` / `og:url` / `og:image` | 実際のURLと、SNSシェア用画像（1200×630px） |
| `<link rel="icon">` | ブランドロゴのファビコン |
| 最終CTAのボタン `href="#"` | 問い合わせフォーム または LINE友だち追加のURL |
| 代表メッセージの「山田 花子」 | 実際の代表者名 |
| 運営会社セクションの数字 | 実績値（制作実績数など） |
| フッターのコピーライト | 実際の会社名 |
| 各プレースホルダー画像 | 下記「必要な画像一覧」を参照 |

## 必要な画像一覧

HTML内に `<!-- 使用画像：… -->` のコメントで、どんな写真を入れるべきか記載しています。

| 推奨ファイル名 | 内容 |
|---|---|
| `assets/hero-owner.jpg` | ファーストビュー。女性サロンオーナーがPCとスマホを使うシーン（横1600px以上） |
| `assets/future-01-instagram.jpg` | スマホでInstagramのサロンアカウントを見る手元 |
| `assets/future-02-line.jpg` | 公式LINEの管理画面を確認するサロンオーナー |
| `assets/future-03-branding.jpg` | ロゴ入り名刺・メニュー表などのフラットレイ |
| `assets/future-04-template.jpg` | ノートPCでSNS投稿テンプレートを編集する女性 |
| `assets/ceo-portrait.jpg` | 代表ポートレート（縦4:5） |
| `assets/final-cta-salon.jpg` | 最終CTAの背景。広く明るいサロン空間（横2000px以上） |
| `assets/template-pc.jpg` / `template-sp.jpg` | Canvaテンプレートの実画面（任意） |

差し替え方法は、プレースホルダーの `<div class="ph">…</div>` を
`<img src="assets/hero-owner.jpg" alt="説明文">` に置き換えるだけです。
