# SEIRAI 募集LP

BUSINESS × AI × COMMUNITY ／ AIを武器に事業を育てたい経営者・起業家のための実践型ビジネスコミュニティ「SEIRAI」の募集ランディングページです。

## 中身

```
seirai-lp/
├── index.html              LPの本体（文章はすべてここ）
├── join/index.html         参加お申し込みページ
├── event/index.html        説明会・体験イベントのページ
└── assets/
    ├── style.css           デザイン（色・文字・レイアウト）
    ├── form.css            申込みページ専用のデザイン
    ├── main.js             スクロールの動きなど
    ├── form-config.js      ★申込みフォームの送信先（公開前に要設定）
    ├── form.js             フォームの送信処理
    └── images/             写真を入れるフォルダ（README.md に手順あり）
```

## ★公開前に必要な設定：フォームの送信先

申込みフォームは、そのままでは送信先がないため「準備中」と表示されます。
無料のフォームサービスに登録し、発行されたURLを `assets/form-config.js` に入れてください。

```js
window.SEIRAI_FORM = {
  join:  'https://formspree.io/f/xxxxxxxx',   // 入会申込み
  event: 'https://formspree.io/f/xxxxxxxx'    // 説明会申込み
};
```

使えるサービスの例：

| サービス | 特徴 |
|---|---|
| Formspree（formspree.io） | 英語。無料で月50件まで。登録してすぐ使えます |
| SSGform（ssgform.com） | 日本語。無料。メール通知つき |

どちらも「HTMLのフォームから送信を受け取り、メールで通知する」サービスです。
申込み内容はサービス側の管理画面にも残ります。

## 見る方法

`index.html` をダブルクリックしてブラウザで開くだけで表示されます。
サーバーや専門ソフトは不要です。

## ブランド設定

| 項目 | 値 |
|---|---|
| Deep Navy | `#0B2545`（信頼・知性・安定） |
| Champagne Gold | `#D4AF7C`（輝き・挑戦・高貴） |
| Ivory White | `#FAF8F3`（清らかさ・余白） |
| Mist Blue | `#9FB3C8`（穏やかさ・可能性） |
| 和文フォント | Noto Serif JP ／ Zen Kaku Gothic New |
| 欧文フォント | Cormorant Garamond |

ロゴ（S字の流れ＋星＋SEIRAIロゴタイプ）は画像ではなくSVGで作ってあるため、
拡大しても劣化せず、色もCSSで変更できます。定義は `index.html` の冒頭にあります。

## ページ構成（全16ブロック）

1. ファーストビュー — 凛と、しなやかに。AIとともに、事業のその先へ。
2. SEIRAIが目指すもの
3. Problem — こんなことを感じていませんか？
4. BUSINESS × AI × COMMUNITY（3つの軸）
5. ブランドストーリー（SEI／AI／RAIの意味）
6. SEIRAIでできること（SESSION／MEET／CONNECT／AI UPDATE）
7. ブリッジ — 本気で事業を変えたい人へ
8. 3か月集中プログラム AI Business Accelerator（200,000円）
9. 2人の代表（青木真弓／田中結子）
10. TECHNOLOGY × CHOICE — 2人の想いが交わる場所
11. どんな方に来てほしいか
12. SEIRAIで生まれてほしいこと（6つの価値）
13. Community Membership（月額5,500円想定／創設メンバー募集）
14. 料金比較（Community と Accelerator）
15. 最後のメッセージ
16. 最終CTA

## 公開前にやること

1. **フォームの送信先を設定** … 上記 `assets/form-config.js`（これが未設定だと申込みを受け取れません）
2. **料金の確定** … 月額5,500円は「想定」表記にしてあります。確定後に文言を修正
3. **説明会の日程** … `event/index.html` は「日程が決まり次第ご連絡」としています。確定したら記載を更新

## 公開方法の例

- レンタルサーバーに `seirai-lp` フォルダごとアップロード
- または Netlify / Vercel などにフォルダをドラッグ＆ドロップ

## 1ファイルにまとめて配布する

`node build-single.js` を実行すると、CSS・JSを1つに埋め込んだ `seirai-lp-single.html` が生成されます。
このファイルは単体でメール添付や共有ができ、公開URL（Artifact）の作成にも使っています。
