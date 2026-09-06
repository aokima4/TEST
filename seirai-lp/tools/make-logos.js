/* 添付ロゴ（白背景）から、背景透過＋濃紺背景用（紺→アイボリー）のPNGを書き出す */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3] || path.join(__dirname, '../assets/images');

/* 元画像1254x1254 内の各パーツの位置（上端・下端） */
const CROPS = [
  { name: 'logo-mark',     y0: 150, y1: 680,  outW: 280 },  // シンボルマーク
  { name: 'logo-wordmark', y0: 700, y1: 945,  outW: 580 },  // SEIRAI + BUSINESS × AI × COMMUNITY
  { name: 'logo-stack',    y0: 150, y1: 945,  outW: 760 },  // 縦組みロゴ
  { name: 'logo-full',     y0: 150, y1: 1090, outW: 860 },  // 縦組みロゴ + タグライン
];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.goto('about:blank');
  const data = 'data:image/webp;base64,' + fs.readFileSync(SRC).toString('base64');

  for (const crop of CROPS) {
    for (const variant of ['light', 'ivory']) {
      const url = await p.evaluate(async ({ data, crop, variant }) => {
        const img = new Image(); img.src = data; await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width; c.height = crop.y1 - crop.y0;
        const x = c.getContext('2d');
        x.drawImage(img, 0, -crop.y0);
        const id = x.getImageData(0, 0, c.width, c.height);
        const d = id.data;
        const BG = [d[0], d[1], d[2]];  // 元画像の地色（純白ではなく少しオフホワイト）
        const T = 150;                  // 地色からの距離がこれ以上なら完全不透明
        const CUT = 0.07;               // これ未満は完全透明にして背景の残りを消す
        const IVORY = [250, 248, 243];

        let minX = c.width, maxX = -1, minY = c.height, maxY = -1;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], bl = d[i + 2];
          const dist = Math.sqrt((BG[0] - r) ** 2 + (BG[1] - g) ** 2 + (BG[2] - bl) ** 2);
          let a = Math.min(1, dist / T);
          if (a < CUT) { d[i + 3] = 0; continue; }
          /* 地色との合成を解いて、元のインク色を取り戻す */
          const un = (v, bg) => Math.max(0, Math.min(255, (v - bg * (1 - a)) / a));
          let R = un(r, BG[0]), G = un(g, BG[1]), B = un(bl, BG[2]);
          if (variant === 'ivory') {
            /* 紺系（青が赤より強く暗い）はアイボリーへ置き換える */
            const lum = 0.299 * R + 0.587 * G + 0.114 * B;
            if (B > R + 8 && lum < 150) { R = IVORY[0]; G = IVORY[1]; B = IVORY[2]; }
          }
          d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = Math.round(a * 255);
          const px = (i / 4) % c.width, py = Math.floor((i / 4) / c.width);
          if (px < minX) minX = px; if (px > maxX) maxX = px;
          if (py < minY) minY = py; if (py > maxY) maxY = py;
        }
        x.putImageData(id, 0, 0);

        /* 余白を切り詰める */
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
      }, { data, crop, variant });

      const file = path.join(OUT, crop.name + (variant === 'ivory' ? '-ivory' : '') + '.png');
      const buf = Buffer.from(url.split(',')[1], 'base64');
      fs.writeFileSync(file, buf);
      console.log(path.basename(file), Math.round(buf.length / 1024) + 'KB');
    }
  }
  await b.close();
})();
