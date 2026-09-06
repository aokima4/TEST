#!/usr/bin/env node
/*
 * 写真を Web 用に縮小・再圧縮する。SNS用のOGP画像も切り出せる。
 *
 * なぜ必要か：スマホで撮った写真はそのままだと数MBあり、
 * 表示が遅くなる。表示される最大幅の2倍程度まで縮めれば画質は落ちない。
 *
 * 使い方:
 *   node optimize_images.js --src photo.jpg --out images/hero.jpg --width 1400 --quality 0.86
 *   node optimize_images.js --src photo.jpg --out images/ogp.jpg --crop 1200x630 --focus 0.3
 *
 * --focus は切り抜きの縦位置(0=上, 0.5=中央)。人物写真は 0.2〜0.35 が顔を外しにくい。
 */
const fs = require('fs');
const path = require('path');
const { loadPlaywright } = require('./_playwright');

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; }
const SRC = arg('src'), OUT = arg('out');
if (!SRC || !OUT) { console.error('--src と --out が必要です'); process.exit(1); }
const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const cropSpec = arg('crop');
const job = {
  maxW: parseInt(arg('width', '1600'), 10),
  quality: parseFloat(arg('quality', '0.85')),
  focusY: parseFloat(arg('focus', '0.5')),
  crop: cropSpec ? { w: +cropSpec.split('x')[0], h: +cropSpec.split('x')[1] } : null,
  type: path.extname(OUT).toLowerCase() === '.png' ? 'image/png'
      : path.extname(OUT).toLowerCase() === '.webp' ? 'image/webp' : 'image/jpeg',
};

(async () => {
  const { chromium } = loadPlaywright();
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('about:blank');
  const data = 'data:' + (mime[path.extname(SRC).toLowerCase()] || 'image/jpeg') +
    ';base64,' + fs.readFileSync(SRC).toString('base64');
  const res = await p.evaluate(async ({ data, job }) => {
    const img = new Image(); img.src = data; await img.decode();
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    if (job.crop) {
      c.width = job.crop.w; c.height = job.crop.h;
      const s = Math.max(job.crop.w / img.width, job.crop.h / img.height);
      const dw = img.width * s, dh = img.height * s;
      x.drawImage(img, (job.crop.w - dw) / 2, -(dh - job.crop.h) * job.focusY, dw, dh);
    } else {
      const s = Math.min(1, job.maxW / img.width);
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      x.drawImage(img, 0, 0, c.width, c.height);
    }
    return { url: c.toDataURL(job.type, job.quality), w: c.width, h: c.height, ow: img.width, oh: img.height };
  }, { data, job });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const buf = Buffer.from(res.url.split(',')[1], 'base64');
  fs.writeFileSync(OUT, buf);
  console.log(`${OUT}  ${res.ow}x${res.oh} -> ${res.w}x${res.h}  ${Math.round(buf.length / 1024)}KB`);
  await b.close();
})();
