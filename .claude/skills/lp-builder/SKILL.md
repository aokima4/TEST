---
name: lp-builder
description: ブランドボード（色・フォント・ロゴ）と構成案・コピー案から、日本語のランディングページ／募集ページ／サービス紹介ページを静的HTML+CSS+JSで作り、スマホ表示まで検証して公開する。Use this skill whenever the user asks for a landing page, LP, 募集ページ, 採用ページ, サービス紹介ページ, 会社紹介ページ, キャンペーンページ, セミナー告知ページ, 特設サイト, or a one-page website — including when they paste a copy outline / 構成案 and attach a brand board, logo, or photos, and also when they ask to fix, restyle, or make an existing landing page responsive. Covers pulling attached images out of the conversation, turning a white-background logo into transparent assets, Japanese typography, a mobile-breakage checklist, and publishing.
---

# ランディングページを作る

構成案とブランド素材から、そのまま公開できる静的ページを作る。依頼者は非エンジニアであることが多いので、成果物は「ファイルを置けば動く」形にし、説明は専門用語を避ける。

## 進め方

1. 素材をそろえる（Step 1）
2. ページを組む（Step 2）
3. 検証する（Step 3）— ここを飛ばさない
4. 届ける（Step 4）

作業ディレクトリの構成はこの形を基本にする。CSSとJSを分けておくと、あとから依頼者や他の制作者が触りやすい。

```
<project>/
├── index.html
└── assets/
    ├── style.css
    ├── main.js
    └── images/
```

---

## Step 1: 素材をそろえる

### 添付画像は会話ログから取り出す

チャットに貼られた画像はディスク上には存在しないが、**会話ログ(JSONL)にbase64で残っている**。「画像が届いていません、もう一度送ってください」と言う前に必ずこれを試す。同じ画像が何度も貼られることがあるので、行番号の大きいもの＝最後に貼られたものを採用する。

```bash
node scripts/extract_chat_images.js --out ./extracted        # 全部
node scripts/extract_chat_images.js --out ./extracted --last 3
```

出力の寸法を見て、どれがロゴ・どれが人物写真かを判断する。判断がつかないときは実際に画像を開いて確認する。**人物と名前の対応づけを推測で決めない**——順番から推測したときは、その推測を成果物の説明で明示して確認を求める。

### ブランドボードから設計値を読み取る

ブランドボードの画像から次を拾い、CSS変数にする。**色のコードが書かれていれば必ずその値を使う**。目分量で近い色を置くと、名刺や資料と並べたときにずれる。

- 色（メイン／アクセント／地色／補助色）とそれぞれの役割
- 和文・欧文フォント
- ロゴの構成（縦組み・横組み・シンボルのみ）とタグライン
- 世界観を表す言葉（清らか、凛と、など）→ 余白量や動きの強さの判断材料

### ロゴを使える形にする

支給ロゴはたいてい白背景。そのまま濃色の上に置くと白い四角が出るうえ、ロゴの濃色部分が背景に沈んで読めなくなる。**濃い背景で使うなら反転版が要る**。

```bash
# まず構造を調べる（縦にどこで区切れるか）
node scripts/make_logo_variants.js --src logo.webp --analyze

# analyze の bands を見て、部位ごとに切り出す
node scripts/make_logo_variants.js --src logo.webp --out assets/images \
  --crops "logo-mark:150-680:280,logo-wordmark:700-945:580,logo-stack:150-945:760"
```

`-inv` が付くほうが濃色背景用。ヘッダーのように横長の場所ではシンボルとロゴタイプを横に並べ、広い場所では縦組みを使う。**書き出したら必ず濃色の背景に置いて目で確認する**——白い縁が残っていないか、金や赤などの有彩色が濁っていないか。

### 写真を軽くする

表示される最大幅の約2倍まで縮める。それ以上は容量が増えるだけで画質は変わらない。

```bash
node scripts/optimize_images.js --src photo.jpg --out assets/images/hero.jpg --width 1400
node scripts/optimize_images.js --src photo.jpg --out assets/images/ogp.jpg --crop 1200x630 --focus 0.3
```

素材が手元に無い段階でも組み始めてよい。`<img>` に実ファイル名を書き、後ろに仮のプレースホルダーを重ねておけば、**あとからファイルを置くだけで差し替わる**。依頼者に「このフォルダにこの名前で保存してください」と伝えられる形にしておくと、非エンジニアでも自分で写真を入れられる。

---

## Step 2: ページを組む

構成案が渡されているなら、**その順番と文言を尊重する**。見出しの改行位置や句読点は書き手の意図なので、勝手に整えない。文章を削るのも足すのも、理由があるときだけ。

セクションの作り分け、CSS変数の設計、余白やタイポグラフィの基準は `references/page-structure.md` に置いてある。日本語の組版（行末に1文字だけ残る問題、字間、フォント指定）は `references/japanese-typography.md` を読む。

押さえておく骨格だけここに書く。

- 全セクションで使う値は `:root` のCSS変数にする（色、フォント、最大幅、余白、イージング）
- 本文の最大幅を決め、左右の余白は `clamp()` で画面幅に追従させる
- スクロールで要素を出す演出は `IntersectionObserver` で。`prefers-reduced-motion` を尊重する
- 画像は `object-fit:cover` ＋ `aspect-ratio`。人物写真は `object-position: center 20%` 前後にすると顔が切れにくい
- 申込みボタンのリンク先が未定なら `href="#"` のままにせず、**未定であることを依頼者に明示する**

---

## Step 3: 検証する

**ここを飛ばすと必ず後で「スマホで崩れている」と言われる。** 目視だけでは足りないので機械検査と目視を両方やる。

```bash
node scripts/audit_page.js --url file:///abs/path/index.html --shots ./shots
```

検出できるのは「画面外へのはみ出し」「JSエラー」「読み込めない画像」の3つ。残りは `--shots` で出たセクション画像を**実際に開いて見る**。

そのうえで `references/mobile-checklist.md` を見ながら該当箇所を潰す。ここに載っているのは実際に事故になった項目だけで、特に次の4つは頻度が高い。

1. **横スクロール前提の表** — スマホでは右の列が完全に見えなくなる。項目ごとのカードに組み替える
2. **`flex-basis` が縦並びで高さに効く** — `flex:1 1 200px` のまま `flex-direction:column` にすると、空白だらけの縦長の箱になる
3. **行末に1文字だけ残る改行** — `text-wrap:balance` と、意味の切れ目での明示的な改行で防ぐ
4. **画面下の固定ボタン** — 最終CTAと二重に出る／その下に地色の帯が見える

検証は 360 / 390 / 768 / 1440 px で行う。360pxは小型Android、390pxは標準的なiPhone、768pxはタブレット。

---

## Step 4: 届ける

依頼者が非エンジニアなら、**確認用と公開用を分けて渡す**と話が早い。

### 確認用URL（Artifact）

**共有できるURLが要るかを先に確かめる。** 手元で完成させるだけでよい場面もあるし、
公開は外向きの操作なので、頼まれていないのに毎回やると相手のギャラリーが散らかる。
「スマホで見たい」「相手に見せたい」と言われたら出す、くらいの温度でよい。

1ファイルにまとめてから公開する。画像もフォントも埋め込まれるので、リンク1本で誰でも見られる。

```bash
node scripts/build_single_file.js --src ./index.html --out /tmp/page.html --artifact
```

`--artifact` を付けると `<!doctype>`〜`<body>` の外枠を外す（Artifact側が付けるため）。Artifactツールでこのファイルを公開する。

同じファイルパスで再公開すればURLは変わらない。ただし**共有中のArtifactは、再公開しても共有相手には自動反映されない**ことがある。更新したら「共有設定の更新が必要かもしれない」と一言添える。

### 公開用一式（ZIP）

VercelやNetlifyにドラッグ&ドロップできるフォルダをZIPで渡す。`index.html` と `assets/` をそのまま入れるだけでよい。

```bash
cd <project>/.. && zip -qr site.zip <project>
```

サーバーへの自動デプロイを試みる場合、権限エラーで作成できないことがある。そのときは**手順を代わりに書いて渡す**（インポートするリポジトリ名、ルートディレクトリ、本番ブランチの指定）。「できませんでした」で終わらせない。

### 引き継げる形にする

`README.md` に、更新のしかたを依頼者の言葉で書いておく。どのファイルに文章が入っているか、写真を差し替える手順、公開前に決める必要が残っている項目（料金、申込みリンクなど）。

---

## 参照ファイル

- `references/page-structure.md` — セクションの型、CSS変数の設計、レイアウトの定石
- `references/japanese-typography.md` — 和文の組版、フォント指定、改行の制御
- `references/mobile-checklist.md` — スマホで実際に壊れた箇所と直し方

## 同梱スクリプト

すべて Node.js + Playwright(Chromium) のみで動く。画像処理も表示検査もヘッドレスブラウザで行うため、ImageMagickなどは不要。

| スクリプト | 用途 |
|---|---|
| `extract_chat_images.js` | 会話に添付された画像を取り出す |
| `make_logo_variants.js` | 白背景ロゴ → 透過PNG＋濃色背景用の反転版 |
| `optimize_images.js` | 写真の縮小・再圧縮、OGP画像の切り出し |
| `audit_page.js` | 表示崩れ・JSエラー・画像未読込の検査、セクション画像の保存 |
| `build_single_file.js` | CSS/JS/画像を1つのHTMLにまとめる（重複画像は参照化） |
