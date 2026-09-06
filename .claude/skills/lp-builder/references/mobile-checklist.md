# スマホ表示チェックリスト

実際に「崩れている」と指摘された項目と、その原因・直し方。

以下のCSSに出てくる変数名（`--navy` `--gold-deep` など）は**例**なので、
案件のパレットに合わせて読み替えること。そのままコピーすると未定義の変数になる。

`audit_page.js` は画面外へのはみ出ししか見つけられないので、
**はみ出していないのに崩れて見える**類はここで潰す。

## 目次

1. 横スクロール前提の表
2. 縦並びにしたときの flex-basis
2b. aspect-ratio と height:100% の同時指定
3. 行末に1文字だけ残る改行
4. 画面下の固定ボタン
5. flex に切り替えたときの align-items
6. 装飾要素のずれ
7. ボタンの折り返し
8. セクション見出しの罫線
9. 画像の切れ方
10. 検証する画面幅

---

## 1. 横スクロール前提の表

**症状**: 比較表の右側の列が画面外にあり、存在に気づけない。

`overflow-x:auto` + `min-width:600px` は「横に振れば見える」つもりでも、
スマホでは**スクロールできることに気づかない**。比較表は「両方を並べて見る」のが
目的なので、片方が見えない時点で機能していない。

**直し方**: 表を項目ごとのカードに組み替える。`<td>` に `data-label` を持たせ、
CSSの `content:attr(data-label)` で列名を出す。HTMLの構造は保ったまま見え方だけ変わる。

```html
<tr><th>料金</th>
  <td data-label="Aプラン">月額5,500円</td>
  <td data-label="Bプラン">200,000円</td></tr>
```

```css
@media (max-width:860px){
  table{min-width:0;display:block}
  thead{display:none}
  tbody{display:block}
  tbody tr{display:grid;grid-template-columns:1fr 1fr;margin-bottom:12px;border:1px solid #ddd}
  tbody th{grid-column:1/-1;background:var(--navy);color:#fff;padding:12px 16px;text-align:left}
  tbody td{display:block;padding:16px 12px;text-align:center;border-bottom:0}
  tbody td:first-of-type{border-right:1px solid #ddd}
  tbody td::before{content:attr(data-label);display:block;font-size:10.5px;
    letter-spacing:.14em;color:var(--gold-deep);margin-bottom:8px}
}
```

## 2. 縦並びにしたときの flex-basis

**症状**: 3つ並んだ料金カードが、スマホで空白だらけの縦長の箱になる。

`flex:1 1 200px` の `200px` は**主軸方向の基準サイズ**。
`flex-direction:column` にすると主軸が縦になるので、200pxが**高さ**として効く。

**直し方**: 縦並びにするときは basis を戻す。

```css
@media (max-width:860px){
  .facts{flex-direction:column}
  .fact{flex:0 0 auto}   /* ← これを忘れない */
}
```

## 2b. aspect-ratio と height:100% の同時指定

**症状**: カード内の写真が枠を突き破って横に広がり、隣の本文の上に重なる。

`aspect-ratio:4/5` と `height:100%` を同時に指定すると、高さが親に合わせて決まり、
**幅は比率から逆算されて親の列幅を超える**ことがある。grid のトラック幅（例:200px）は
はみ出しを止めてくれない。

しかもこれは `audit_page.js` では**検出できない**。親に `overflow:hidden` があれば
横スクロールは発生しないので、数値上は正常に見える。セクション画像を目で見て初めて分かる。

**直し方**: どちらか一方にする。比率で見せたいなら `height` を外す。

```css
.card .photo{aspect-ratio:4/5}          /* 高さは比率が決める */
.card .photo{height:100%;aspect-ratio:auto}  /* 高さを親に合わせるなら比率は捨てる */
```

**同型の事故**（サイズを2つの経路から決めてしまう類）:
`flex-basis` と `width` の併記、`min-width` と `max-width` の逆転、
`position:absolute` の `inset` と `width` の併記。

## 3. 行末に1文字だけ残る改行

**症状**: 「もっと選択肢があってい／い。」のように最後の1〜2文字が次行に落ちる。

日本語はどこでも改行できるため、狭い画面では高確率で起きる。見出しほど目立つ。

**直し方**（併用する）:

- `text-wrap:balance` を見出しに。行の長さを揃えてくれる
- `text-wrap:pretty` を本文に。最終行が極端に短くなるのを防ぐ
- スマホの文字サイズを下げる（`clamp()` の最小値を小さく）
- 字間を詰める（`letter-spacing` を `.07em` → `.03em`）
- どうしても意味の切れ目で改行したい箇所は明示する

```html
<span>AIとともに、<br class="sp-br">事業のその先へ。</span>
```
```css
.sp-br{display:none}
@media (max-width:640px){.sp-br{display:inline}}
```

分割したくない語句は `white-space:nowrap` の小さな入れ物に入れる。

```html
<span class="nw">月額 5,500円</span><span class="nw">（想定）</span>
```

## 4. 画面下の固定ボタン

3つの事故が起きやすい。

**(a) 最終CTAと二重に出る** — ページ末尾の「申し込む」ボタンの上に、
同じ文言の固定ボタンが重なる。最終CTAが見えたら引っ込める。

```js
new IntersectionObserver(function(entries){
  sticky.classList.toggle('is-hidden', entries[0].isIntersecting);
}, {threshold:0.12}).observe(document.getElementById('join'));
```

**(b) ボタンの下に地色の帯が見える** — iPhoneは機種によって画面下端の扱いが違い、
`bottom:0` でも数十px の隙間ができることがある。背景を疑似要素で下に伸ばして塞ぐ。

```css
.sticky-cta::after{
  content:"";position:absolute;left:0;right:0;top:100%;height:140px;
  background:rgba(11,37,69,.96);pointer-events:none;
}
```

`env(safe-area-inset-bottom)` にはフォールバック値を書く（iframe内では0になる）。

```css
padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
```

**(c) フッターが隠れる** — 固定ボタンの高さぶん、下に余白を足す。

```css
@media (max-width:860px){ .footer{padding-bottom:calc(44px + 84px)} }
```

**出す高さ**: ファーストビューを抜けきってから出す。0.6倍だとファーストビューの
ボタンと重なる。

```js
sticky.classList.toggle('is-visible', y > hero.offsetHeight * 0.92);
```

## 5. flex に切り替えたときの align-items

**症状**: スマホで見出しだけが中央寄せになり、本文と左端が揃わない。

grid で `align-items:center`（縦方向の中央揃え）を指定していたレイアウトを、
メディアクエリで `display:flex; flex-direction:column` に変えると、
**`align-items` が横方向の中央揃えに化ける**。指定を上書きし忘れると全要素が中央に寄る。

```css
@media (max-width:860px){
  .hero__inner{display:flex;flex-direction:column;align-items:stretch}  /* ← 明示する */
}
```

## 6. 装飾要素のずれ

写真からずらして重ねた枠線、L字の飾り罫、大きな番号など、
広い画面では効くが狭い画面では**ただのズレた線**に見える。スマホでは消す。

```css
@media (max-width:860px){
  .photo-frame{display:none}
  .founder__photo::after{display:none}
}
```

`position:absolute` の装飾が画面外にはみ出すのは、親に `overflow:hidden` があれば実害はない。
`audit_page.js` の `--ignore` で除外できる。

## 7. ボタンの折り返し

長い文言のボタンは、狭い画面で単語の途中から折り返されて読みにくくなる。

- スマホではボタンを全幅にする（`width:100%`）— 押しやすさも上がる
- 文言が長いものは意味の切れ目に `<br class="sp-br">` を入れる
- それでも収まらなければ文言を短くする（依頼者に確認する）

## 8. セクション見出しの罫線

`display:flex` + `::after` で伸ばす金の罫線は、見出しが2行に折り返すと
1行目の横だけに罫線が残って不格好になる。スマホでは罫線を消す。

```css
@media (max-width:860px){
  .label{display:block;letter-spacing:.24em;font-size:12px}
  .label::after,.label::before{display:none}
}
```

## 9. 画像の切れ方

`object-fit:cover` は中央を基準に切るので、縦位置の人物写真を横長の枠に入れると
**顔が切れる**。上寄りにする。

```css
.hero__photo img{object-position:center 20%}
```

素材が縦位置なら、枠の比率のほうを縦（`aspect-ratio:4/5`）や正方形に変えるほうが自然。

## 10. 検証する画面幅

| 幅 | 対象 |
|---|---|
| 360px | 小型Android。ここで通れば大抵通る |
| 390px | 標準的なiPhone |
| 430px | 大型iPhone |
| 768px | タブレット（縦）。スマホ用CSSの上限を超える境目なので崩れやすい |
| 1440px | ノートPC |

スマホ用のメディアクエリを `max-width:860px` にすると768pxも含まれる。
タブレットではボタン全幅が間延びするので、`(min-width:601px) and (max-width:860px)` で
個別に調整する。
