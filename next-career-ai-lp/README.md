# Next Career AI｜ランディングページ

「AI Business Producer Program」Founding Cohort 01（第0期）募集用のLP。
依存なしの静的HTML 1ファイル（`index.html`）で完結しており、そのままどこでもホスティングできます（Vercel / Netlify / GitHub Pages 等）。

## ブランド仕様（トンマナ資料準拠）

| 項目 | 値 |
| --- | --- |
| Main | Deep Navy `#071B36` |
| Accent | Champagne Gold `#C79A46` |
| Sub Gold | Soft Gold `#E4C786` |
| Base | Warm Ivory `#F8F5EF` |
| Dark | Charcoal `#1A1B1D` |
| 英字見出し | Cormorant Garamond（セリフ） |
| 日本語見出し | しっぽり明朝 |
| 本文 | Noto Sans JP |

配色比率はおおよそ Ivory 55% / Navy 30% / Gold 10% / Charcoal 5%。

## 公開前にやること

1. **CTAリンクの差し替え**: `index.html` 内の `<!-- TODO: 診断フォーム` コメント周辺と、`href="#entry"` になっているCTAボタンのリンク先を、実際の無料診断フォーム（Googleフォーム・LINE等）のURLに変更してください。
2. **ロゴの差し替え（任意）**: 現在はロゴを再現したインラインSVGを使用しています。正式なロゴデータ（SVG/PNG）に置き換える場合は、`<svg viewBox="0 0 132 120">` のブロック（ヘッダー・ヒーロー・フッターの3箇所）を `<img>` に置き換えてください。
3. **OGP画像**: 必要に応じて `og:image` メタタグを追加してください。
