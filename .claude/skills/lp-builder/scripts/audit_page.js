#!/usr/bin/env node
/*
 * ページの表示崩れを機械的に検出する。作ったら必ずこれを通す。
 *
 * なぜ必要か：スマホの崩れは「見れば分かる」が、目視だけだと見落とす。
 * 特に (1)画面外へのはみ出し (2)JSエラー (3)読み込めていない画像 は
 * 機械が確実に見つけられる。残りはセクション画像を目で確認する。
 *
 * 使い方:
 *   node audit_page.js --url file:///path/index.html
 *   node audit_page.js --url file:///path/index.html --shots ./shots --width 390
 *   node audit_page.js --url http://localhost:8080 --widths 360,390,430,768,1440
 *
 * 出力: 幅ごとに「横スクロール量 / はみ出し要素 / JSエラー / 未読込画像」。
 * --shots を付けると section ごとの画像も保存する（目視確認用）。
 */
const path = require('path');
const fs = require('fs');
const { loadPlaywright } = require('./_playwright');

function arg(n, d) { const i = process.argv.indexOf('--' + n); return i > -1 ? process.argv[i + 1] : d; }
const URL = arg('url');
if (!URL) { console.error('--url が必要です'); process.exit(1); }
const WIDTHS = (arg('widths', arg('width', '360,390,768,1440'))).split(',').map(Number);
const SHOTS = arg('shots');
/* 装飾用の要素は意図的にはみ出させることがあるので、除外できるようにする */
const IGNORE = arg('ignore', '[class*="glow"],[class*="river"],[class*="decor"]');

(async () => {
  const { chromium } = loadPlaywright();
  const b = await chromium.launch();
  let problems = 0;

  for (const w of WIDTHS) {
    const p = await b.newPage({ viewport: { width: w, height: 900 } });
    const errors = [];   // ページ自体の不具合
    const netWarn = [];  // 外部リソースの取得失敗（サンドボックスではフォントCDNが塞がれていることが多い）
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() !== 'error' || /favicon/i.test(m.text())) return;
      (/Failed to load resource|ERR_/.test(m.text()) ? netWarn : errors).push(m.text());
    });
    /* 'load' だと外部フォントの取得待ちで止まることがあるため domcontentloaded にする */
    p.setDefaultTimeout(20000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }).catch((e) => console.log('  読み込み警告: ' + e.message.split('\n')[0]));
    await p.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
    /* 表示アニメーションを全部終わった状態にしてから測る */
    await p.evaluate(() => document.querySelectorAll('.reveal,[data-reveal]').forEach((e) => e.classList.add('is-in')));
    /* 遅延読み込みの画像を出させるため、一度最後までスクロールする */
    await p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      window.scrollTo(0, 0);
    });
    /* 遅延読み込みの画像が出そろうまで待つ（decode() は待ち続けることがあるので使わない） */
    await p.waitForTimeout(1500);

    const rep = await p.evaluate((ignore) => {
      const vw = document.documentElement.clientWidth;
      const over = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        if (getComputedStyle(el).position === 'fixed') return;
        if (ignore && el.closest(ignore)) return;
        if (r.right > vw + 1 || r.left < -1) {
          const cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || '';
          over.push(el.tagName.toLowerCase() + (cls ? '.' + String(cls).trim().split(/\s+/)[0] : '') +
            ` [${Math.round(r.left)}..${Math.round(r.right)}]`);
        }
      });
      const imgs = [...document.querySelectorAll('img')];
      return {
        hScroll: document.documentElement.scrollWidth - vw,
        overflow: [...new Set(over)].slice(0, 12),
        /* src が data URI だと表示が長くなるので短く切る。
           complete かつ naturalWidth が 0 のものだけが「本当に読めていない」画像 */
        imagesBroken: imgs.filter((i) => i.complete && !i.naturalWidth)
          .map((i) => (i.getAttribute('src') || i.getAttribute('data-img-ref') || '?').slice(0, 60))
          .slice(0, 8),
        imagesPending: imgs.filter((i) => !i.complete).length,
        imageCount: imgs.length,
        height: document.body.scrollHeight,
      };
    }, IGNORE);

    const bad = rep.hScroll > 0 || rep.overflow.length || rep.imagesBroken.length || errors.length;
    if (bad) problems++;
    console.log(`\n=== width ${w}px === ${bad ? '⚠ 要確認' : 'OK'}`);
    console.log(`  横スクロール: ${rep.hScroll}px / ページ高さ: ${rep.height}px / 画像: ${rep.imageCount}枚`);
    if (rep.imagesPending) console.log(`  （読み込み途中の画像: ${rep.imagesPending}枚）`);
    if (rep.overflow.length) console.log('  はみ出し: ' + rep.overflow.join(', '));
    if (rep.imagesBroken.length) console.log('  画像が読めない: ' + rep.imagesBroken.join(', '));
    if (errors.length) console.log('  JSエラー: ' + errors.join(' | '));
    if (netWarn.length) console.log(`  ネットワーク警告 ${netWarn.length}件（外部フォント等。実環境では通常問題なし）`);

    if (SHOTS && w === WIDTHS[0]) {
      const dir = path.join(SHOTS, 'w' + w);
      fs.mkdirSync(dir, { recursive: true });
      const secs = await p.$$('section, footer, main > div');
      for (let i = 0; i < secs.length; i++) {
        await secs[i].scrollIntoViewIfNeeded().catch(() => {});
        await p.waitForTimeout(150);
        await secs[i].screenshot({ path: path.join(dir, 's' + String(i).padStart(2, '0') + '.png') }).catch(() => {});
      }
      console.log(`  セクション画像: ${dir}/ (${secs.length}枚) — 目視で確認すること`);
    }
    await p.close();
  }
  await b.close();
  console.log(problems ? `\n${problems} 個の幅で要確認の項目があります。` : '\nすべての幅で問題は見つかりませんでした。');
})();
