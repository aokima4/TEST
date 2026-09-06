#!/usr/bin/env node
/*
 * 白背景のロゴ画像から、Webで使える透過PNGを書き出す。
 *
 * なぜ必要か：支給されるロゴはたいてい白背景のJPG/PNG/WebP。
 * それをそのまま濃色の背景に置くと「白い四角」が出る。さらに、ロゴの濃色部分
 * （紺・黒など）は濃い背景の上では見えなくなる。だから2種類を作る：
 *   - 通常版      : 背景だけ透過。明るい背景で使う。
 *   - 反転版(-inv): 濃色のインクを明色に置き換える。濃い背景で使う。
 *
 * 使い方:
 *   # まず構造を調べる（縦にどこで区切れるか＝マーク／ロゴタイプ／タグライン）
 *   node make_logo_variants.js --src logo.webp --analyze
 *
 *   # 全体を書き出す
 *   node make_logo_variants.js --src logo.webp --out ./images
 *
 *   # 帯を指定して部位ごとに切り出す（analyze の結果を見て決める）
 *   node make_logo_variants.js --src logo.webp --out ./images \
 *     --crops "mark:150-680:280,wordmark:700-945:580,stack:150-945:760"
 *     # 書式: 名前:上端-下端:出力幅px  をカンマ区切り
 *
 * オプション:
 *   --light "250,248,243"  反転版で濃色インクを置き換える色（既定: アイボリー）
 *   --threshold 150        地色からこの距離以上離れた画素を完全不透明にする
 */
const fs = require('fs');
const path = require('path');
const { loadPlaywright } = require('./_playwright');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}
const SRC = arg('src');
if (!SRC) { console.error('--src が必要です'); process.exit(1); }
const OUT = arg('out', './images');
const ANALYZE = process.argv.includes('--analyze');
const LIGHT = arg('light', '250,248,243').split(',').map(Number);
const T = parseInt(arg('threshold', '150'), 10);

const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function parseCrops(spec) {
  if (!spec) return null;
  return spec.split(',').map((s) => {
    const [name, range, w] = s.split(':');
    const [y0, y1] = range.split('-').map(Number);
    return { name: name.trim(), y0, y1, outW: parseInt(w || '900', 10) };
  });
}

(async () => {
  const { chromium } = loadPlaywright();
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('about:blank');
  const data = 'data:' + (mime[path.extname(SRC).toLowerCase()] || 'image/png') +
    ';base64,' + fs.readFileSync(SRC).toString('base64');

  if (ANALYZE) {
    const info = await p.evaluate(async (data) => {
      const img = new Image(); img.src = data; await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height).data;
      const bg = [d[0], d[1], d[2]];
      const rows = [];
      for (let y = 0; y < c.height; y++) {
        let n = 0;
        for (let xx = 0; xx < c.width; xx++) {
          const i = (y * c.width + xx) * 4;
          if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 36) n++;
        }
        rows.push(n);
      }
      const bands = []; let s = -1;
      for (let y = 0; y < rows.length; y++) {
        const on = rows[y] > 2;
        if (on && s < 0) s = y;
        if ((!on || y === rows.length - 1) && s >= 0) { if (y - s > 3) bands.push([s, y]); s = -1; }
      }
      return { size: [img.width, img.height], background: bg, bands };
    }, data);
    console.log(JSON.stringify(info, null, 1));
    console.log('\nbands は「中身がある縦の範囲」。上から順に マーク / ロゴタイプ / 英語小見出し / タグライン ...');
    await b.close();
    return;
  }

  fs.mkdirSync(OUT, { recursive: true });
  const crops = parseCrops(arg('crops')) || [{ name: 'logo', y0: 0, y1: 0, outW: parseInt(arg('width', '900'), 10) }];

  for (const crop of crops) {
    for (const variant of ['light', 'inv']) {
      const url = await p.evaluate(async ({ data, crop, variant, LIGHT, T }) => {
        const img = new Image(); img.src = data; await img.decode();
        const y0 = crop.y0 || 0;
        const y1 = crop.y1 || img.height;
        const c = document.createElement('canvas');
        c.width = img.width; c.height = y1 - y0;
        const x = c.getContext('2d');
        x.drawImage(img, 0, -y0);
        const id = x.getImageData(0, 0, c.width, c.height);
        const d = id.data;
        const BG = [d[0], d[1], d[2]];   // 角の画素＝地色。純白とは限らない
        const CUT = 0.07;                // これ未満の不透明度は捨てる（地色の残りを消す）

        let minX = c.width, maxX = -1, minY = c.height, maxY = -1;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], bl = d[i + 2];
          const dist = Math.sqrt((BG[0] - r) ** 2 + (BG[1] - g) ** 2 + (BG[2] - bl) ** 2);
          const a = Math.min(1, dist / T);
          if (a < CUT) { d[i + 3] = 0; continue; }
          /* 地色との合成を解いて、元のインク色を取り戻す（縁の白いにじみを防ぐ） */
          const un = (v, bg) => Math.max(0, Math.min(255, (v - bg * (1 - a)) / a));
          let R = un(r, BG[0]), G = un(g, BG[1]), B = un(bl, BG[2]);
          if (variant === 'inv') {
            const lum = 0.299 * R + 0.587 * G + 0.114 * B;
            /* 濃色インク（暗くて青寄り or ただ暗い）を明色へ。金・赤などの有彩色は残す */
            if (lum < 150 && B >= R - 10) { R = LIGHT[0]; G = LIGHT[1]; B = LIGHT[2]; }
          }
          d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = Math.round(a * 255);
          const px = (i / 4) % c.width, py = Math.floor((i / 4) / c.width);
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
        x.putImageData(id, 0, 0);

        const pad = 4;
        const cw = Math.min(c.width, maxX - minX + 1 + pad * 2);
        const ch = Math.min(c.height, maxY - minY + 1 + pad * 2);
        const scale = Math.min(1, crop.outW / cw);
        const o = document.createElement('canvas');
        o.width = Math.round(cw * scale); o.height = Math.round(ch * scale);
        const ox = o.getContext('2d');
        ox.imageSmoothingQuality = 'high';
        ox.drawImage(c, minX - pad, minY - pad, cw, ch, 0, 0, o.width, o.height);
        return o.toDataURL('image/png');
      }, { data, crop, variant, LIGHT, T });

      const file = path.join(OUT, crop.name + (variant === 'inv' ? '-inv' : '') + '.png');
      const buf = Buffer.from(url.split(',')[1], 'base64');
      fs.writeFileSync(file, buf);
      console.log(path.basename(file), Math.round(buf.length / 1024) + 'KB');
    }
  }
  await b.close();
})();
