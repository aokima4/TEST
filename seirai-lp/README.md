# SEIRAI 募集LP

BUSINESS × AI × COMMUNITY ／ 女性起業家・女性経営者のための実践型ビジネスコミュニティ「SEIRAI」の募集ランディングページです。

## 中身

```
seirai-lp/
├── index.html              LPの本体（文章はすべてここ）
└── assets/
    ├── style.css           デザイン（色・文字・レイアウト）
    ├── main.js             スクロールの動きなど
    └── images/             写真を入れるフォルダ（README.md に手順あり）
```

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
11. どんな女性に来てほしいか
12. SEIRAIで生まれてほしいこと（6つの価値）
13. Community Membership（月額5,500円想定／創設メンバー募集）
14. 料金比較（Community と Accelerator）
15. 最後のメッセージ
16. 最終CTA

## 公開前にやること（3つだけ）

1. **写真を入れる** … `assets/images/README.md` の手順どおりに3枚を保存
2. **申込みボタンのリンク先を設定** … `index.html` の最後のCTAにある
   `data-cta="join"` と `data-cta="event"` の `href="#"` を、申込みフォームのURLに置き換え
3. **料金の確定** … 月額5,500円は「想定」表記にしてあります。確定後に文言を修正

## 公開方法の例

- レンタルサーバーに `seirai-lp` フォルダごとアップロード
- または Netlify / Vercel などにフォルダをドラッグ＆ドロップ
