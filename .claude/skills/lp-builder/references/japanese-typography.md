# 日本語ページの組版

欧文向けの初期値のままだと、日本語は間延びしたり、変な位置で折り返したりする。
最低限ここに書いたことを入れておくと、それらしく見える。

## フォント指定

Google Fonts から読む場合の定番。明朝はブランドの格式、ゴシックは可読性。

```css
:root{
  --serif-jp:"Noto Serif JP",'Hiragino Mincho ProN','Yu Mincho',serif;
  --sans-jp:"Zen Kaku Gothic New",'Hiragino Sans','Yu Gothic',sans-serif;
  --serif-en:"Cormorant Garamond","Times New Roman",serif;
}
```

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;600&family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap" rel="stylesheet">
```

`display=swap` を必ず付ける。付けないとフォント取得が終わるまで文字が出ない。
和文フォントは重いので、使うウェイトだけを指定する。

見出しは明朝、本文はゴシック、英字の小見出しは欧文セリフ——という使い分けにすると、
和欧混植でも破綻しにくい。

## 字詰め

```css
body{ font-feature-settings:"palt"; letter-spacing:.04em; }
```

`palt` は「約物（句読点や括弧）の余分な空きを詰める」指定。
これが無いと「、」や「）」の後ろが不自然に空く。

字間はデスクトップで `.04em`〜`.08em`、スマホでは `.02em` 程度まで詰める。
画面が狭いほど、字間は折り返しの敵になる。

## 行間

日本語は欧文より行間を広く取る。

- 本文: `line-height: 1.9` 〜 `2.2`
- 見出し: `1.4` 〜 `1.6`
- 短いキャッチコピー: `1.6` 〜 `1.75`

## 折り返しの制御

```css
h1,h2,h3,h4{ text-wrap:balance; }   /* 行の長さを揃える。1文字だけ残るのを防ぐ */
p,li,dd{ text-wrap:pretty; }        /* 最終行が極端に短くなるのを防ぐ */
```

`text-wrap:balance` は見出しなど短いテキスト向け。長い本文に使うと重くなる。
未対応ブラウザでは無視されるだけなので、書いて損はない。

意味の切れ目で必ず改行したい箇所は、画面幅で出し分ける。
**初期値の `display:none` とメディアクエリは必ずセットで書く**。
片方だけだと、全画面で改行される／どの画面でも改行されない、のどちらかになる。

```css
.sp-br{display:none}                              /* ← これを忘れない */
@media (max-width:640px){.sp-br{display:inline}}
```
```html
<span>AIとともに、<br class="sp-br">事業のその先へ。</span>
```

`word-break:keep-all` は日本語では使わない。CJKでは「どこでも改行できる」性質を
止めてしまい、文字がはみ出す。

## 文字サイズ

`clamp(最小, 画面幅比, 最大)` で画面に追従させる。
**最小値はスマホでの実寸**なので、ここを大きくしすぎると折り返しが破綻する。

```css
.h-lead{ font-size:clamp(22px,5.9vw,46px); }   /* 390px幅で約23px */
body{ font-size:16px; }                         /* 本文はスマホで15px前後まで */
```

日本語の見出しは、スマホでは 22〜26px あたりが上限。
それ以上にすると1行に7〜8文字しか入らず、行が細切れになる。

## 縦書き

キャッチコピーを縦に置くと和の雰囲気が出る。狭い画面では場所を取るので消す。

```css
.vertical{writing-mode:vertical-rl;letter-spacing:.5em}
@media (max-width:860px){.vertical{display:none}}
```

## 数字と英字

和文中の数字・英字は欧文フォントで組むと締まる。
金額や年号など、途中で切れると意味が壊れるものは `nowrap` で守る。

```css
.nw{white-space:nowrap;display:inline-block}
```
