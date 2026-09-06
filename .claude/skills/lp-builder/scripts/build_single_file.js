#!/usr/bin/env node
/*
 * index.html + CSS + JS + 画像 を、1つのHTMLファイルにまとめる。
 *
 * なぜ必要か：Artifactでの公開やメール添付は「1ファイル」でないと成立しない。
 * 画像は data URI として埋め込む。同じ画像が複数回使われる場合は1回だけ
 * 埋め込んで、残りは読み込み時にコピーする（ファイルが倍々に膨らむのを防ぐ）。
 *
 * 使い方:
 *   node build_single_file.js --src ./site/index.html --out ./dist/page.html
 *
 * Artifactとして公開する場合は --artifact を付ける。
 * <!doctype>/<html>/<head>/<body> を外し、<title>・<style>・本文・<script>
 * だけを出力する（Artifactが独自の外枠を付けるため）。
 */
const fs = require('fs');
const path = require('path');

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; }
const SRC = arg('src'), OUT = arg('out');
if (!SRC || !OUT) { console.error('--src と --out が必要です'); process.exit(1); }
const ARTIFACT = process.argv.includes('--artifact');
const root = path.dirname(path.resolve(SRC));
const html = fs.readFileSync(SRC, 'utf8');

const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Page';
const fontLinks = (html.match(/<link[^>]+fonts\.googleapis\.com[^>]*>/g) || []).join('\n');

/* <link rel=stylesheet href="...css"> を中身に置き換える */
const cssFiles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map((m) => m[1]);
const css = cssFiles
  .filter((f) => !/^https?:/.test(f))
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n');

/* <script src="...js"> を中身に置き換える */
const jsFiles = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g)].map((m) => m[1]);
const js = jsFiles
  .filter((f) => !/^https?:/.test(f))
  .map((f) => fs.readFileSync(path.join(root, f), 'utf8'))
  .join('\n');

let body = html.includes('<body>') ? html.split('<body>')[1].split('</body>')[0] : html;
jsFiles.forEach((f) => { body = body.replace(new RegExp('<script[^>]+src="' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*></script>'), ''); });

/* 画像を data URI 化。2回目以降の同じ画像は参照だけにする */
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif' };
const seen = new Set();
let dedupe = false;
body = body.replace(/src="((?!https?:|data:)[^"]+\.(?:jpg|jpeg|png|webp|svg|gif))"/gi, (m, rel) => {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) { console.warn('見つからない画像: ' + rel); return m; }
  const type = mime[path.extname(abs).toLowerCase()];
  const key = path.basename(rel);
  if (seen.has(key)) { dedupe = true; return `data-img-ref="${key}"`; }
  seen.add(key);
  return `data-img="${key}" src="data:${type};base64,${fs.readFileSync(abs).toString('base64')}"`;
});

const dedupeScript = dedupe ? `
<script>
/* 同じ画像を使い回す（同じデータを何度も埋め込まないため） */
document.querySelectorAll('[data-img-ref]').forEach(function (el) {
  var o = document.querySelector('[data-img="' + el.getAttribute('data-img-ref') + '"]');
  if (o) el.src = o.src;
});
</script>` : '';

const parts = [
  `<title>${title}</title>`,
  fontLinks,
  `<style>\n${css}\n</style>`,
  body.trim(),
  dedupeScript,
  js ? `<script>\n${js}\n</script>` : '',
];
const out = ARTIFACT
  ? parts.filter(Boolean).join('\n') + '\n'
  : `<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n` +
    parts.slice(0, 3).filter(Boolean).join('\n') + `\n</head>\n<body>\n` +
    parts.slice(3).filter(Boolean).join('\n') + `\n</body>\n</html>\n`;

fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
fs.writeFileSync(OUT, out);
console.log(`${OUT}  ${(Buffer.byteLength(out) / 1024 / 1024).toFixed(2)}MB  画像${seen.size}種${dedupe ? '（重複は参照化）' : ''}`);
