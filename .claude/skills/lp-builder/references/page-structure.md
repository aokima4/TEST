# ページの組み立て方

## CSS変数の設計

全セクションで使う値は最初にまとめる。あとから「ブランドの色が変わった」と言われても
ここだけ直せば済む。

```css
:root{
  /* ブランドボードから取る。役割ごとに名前を付けると使い分けを間違えにくい */
  --navy:#0B2545;        /* 主色：信頼・安定 */
  --navy-deep:#061729;   /* 主色の濃い版：背景のグラデーション用 */
  --gold:#D4AF7C;        /* 差し色：CTA・罫線・強調 */
  --ivory:#FAF8F3;       /* 地色：余白 */
  --mist:#9FB3C8;        /* 補助：濃色背景上の本文 */

  --ink:#1A2A3A;         /* 本文 */
  --ink-sub:#5A6A7A;     /* 補足文 */

  --serif-jp:"Noto Serif JP",serif;
  --sans-jp:"Zen Kaku Gothic New",sans-serif;
  --serif-en:"Cormorant Garamond",serif;

  --maxw:1120px;
  --gutter:clamp(20px,5vw,40px);   /* 左右の余白 */
  --sec-y:clamp(72px,10vw,140px);  /* セクションの上下余白 */
  --ease:cubic-bezier(.22,.61,.36,1);
}
```

余白を `clamp()` にしておくと、メディアクエリを書かなくても画面幅に追従する。
メディアクエリは「並び順や構造を変えるとき」だけに使う。

## セクションの型

```html
<section class="section section--navy" id="about">
  <div class="wrap">
    <p class="label">01 &nbsp; SECTION NAME</p>
    <h2 class="h-lead">日本語の見出し</h2>
    <span class="gold-line"></span>
    <p class="lede">補足の1〜2行</p>
    <!-- 中身 -->
  </div>
</section>
```

```css
.wrap{width:100%;max-width:var(--maxw);margin-inline:auto;padding-inline:var(--gutter)}
.section{padding-block:var(--sec-y);position:relative}
.section--navy{background:var(--navy);color:var(--ivory)}
```

濃色セクションと地色セクションを交互に置くと、長いページでもリズムが出る。
同じ色が3つ続いたら間延びを疑う。

## リズムの作り方

LPは上から下へ読ませる一本道なので、同じ見せ方が続くと飽きられる。
型を変えながら進める。

| 見せ方 | 向いている内容 |
|---|---|
| 大きなキャッチ＋写真 | ファーストビュー、最後のメッセージ |
| 2カラム（文章＋カード） | 課題提起、ビジョン |
| チェックリスト（2列） | 「こんなことありませんか？」 |
| 3枚のカード | サービスの柱、価値 |
| 中央寄せの大きな一文 | 断言、転換点 |
| 表 | 料金比較 |
| 縦積みのカード | 代表紹介、月ごとのプログラム |

## スクロール表示の演出

```js
var io = new IntersectionObserver(function(entries){
  entries.forEach(function(e){
    if (e.isIntersecting){ e.target.classList.add('is-in'); io.unobserve(e.target); }
  });
}, { rootMargin:'0px 0px -12% 0px', threshold:0.08 });
document.querySelectorAll('.reveal').forEach(function(el){ io.observe(el); });
```

```css
.reveal{opacity:0;transform:translateY(28px);transition:opacity 1s var(--ease),transform 1s var(--ease)}
.reveal.is-in{opacity:1;transform:none}
.reveal[data-d="1"]{transition-delay:.12s}   /* 順番に出す */

@media (prefers-reduced-motion:reduce){
  .reveal{opacity:1;transform:none;transition:none}
}
```

`unobserve` を忘れない（戻ったときに再度消えるのを防ぐ）。
`prefers-reduced-motion` は必ず尊重する——動きに酔う人がいる。

## 画像の枠

```css
.photo{position:relative;overflow:hidden;background:var(--navy-deep)}
.photo img{width:100%;height:100%;object-fit:cover;position:relative;z-index:2}
.photo{aspect-ratio:4/5}
```

`aspect-ratio` で枠を先に決めておくと、画像の読み込み前後でページが飛び跳ねない。

素材が届く前に組むときは、`<img>` の下にプレースホルダーを敷いておく。

```html
<div class="photo">
  <img src="assets/images/hero.jpg" alt="..." onerror="this.style.display='none'">
  <div class="photo__ph">HERO</div>
</div>
```

```js
/* 画像が入ったらプレースホルダーを隠す */
document.querySelectorAll('.photo img').forEach(function(img){
  function done(){ var ph=img.parentNode.querySelector('.photo__ph');
    if (ph && img.naturalWidth>0) ph.style.display='none'; }
  if (img.complete) done();
  img.addEventListener('load', done);
});
```

## ヘッダーとナビ

- ヘッダーは `position:fixed`。スクロールしたら背景を付ける（最初は透過のほうが写真が映える）
- スマホはハンバーガーメニュー。開いている間は `body{overflow:hidden}`
- ページ内リンクはヘッダーの高さぶんオフセットする

```js
var top = target.getBoundingClientRect().top + window.pageYOffset - header.offsetHeight - 8;
window.scrollTo({ top:top, behavior:reduce ? 'auto' : 'smooth' });
```

## SEOとSNS

```html
<title>ブランド名｜キャッチコピー</title>
<meta name="description" content="120文字程度。誰向けの何かを具体的に">
<meta property="og:title" content="...">
<meta property="og:description" content="...">
<meta property="og:image" content="assets/images/ogp.jpg">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0B2545">
```

OGP画像は 1200×630px。`optimize_images.js --crop 1200x630 --focus 0.3` で作れる。
