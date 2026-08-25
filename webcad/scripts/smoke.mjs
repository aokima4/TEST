/** ブラウザでの動作確認（自動スモークテスト） */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const server = spawn('node', [path.join(root, 'scripts/dev-server.mjs')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

const errors = [];
let browser;
try {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const canvas = await page.locator('#canvas').boundingBox();
  const cmd = page.locator('#cmdline');

  // --- 矩形を数値入力で作図（0,0 → 100,60）
  await cmd.click();
  await cmd.fill('REC'); await cmd.press('Enter');
  await cmd.fill('0,0'); await cmd.press('Enter');
  await cmd.fill('100,60'); await cmd.press('Enter');

  // --- 円を数値で
  await cmd.fill('C'); await cmd.press('Enter');
  await cmd.fill('C'); await cmd.press('Enter');
  await cmd.fill('25,30'); await cmd.press('Enter');
  await cmd.fill('@8.75,0'); await cmd.press('Enter');

  // --- 線（相対極座標）
  await cmd.fill('L'); await cmd.press('Enter');
  await cmd.fill('10,10'); await cmd.press('Enter');
  await cmd.fill('@50<30'); await cmd.press('Enter');
  await page.keyboard.press('Escape');

  // --- 長さ寸法
  await cmd.fill('DLI'); await cmd.press('Enter');
  await cmd.fill('0,0'); await cmd.press('Enter');
  await cmd.fill('100,0'); await cmd.press('Enter');
  await cmd.fill('50,-15'); await cmd.press('Enter');

  await page.keyboard.press('Control+0');
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => {
    const app = window.cad;
    const types = {};
    for (const e of app.doc.entities) types[e.type] = (types[e.type] ?? 0) + 1;
    return {
      count: app.doc.entities.length,
      types,
      fps: app.fps,
      first: app.doc.entities[0],
      allInt: app.doc.entities.every((e) =>
        Object.entries(e).every(([k, v]) => typeof v !== 'number' || Number.isInteger(v))),
    };
  });
  console.log('図形:', JSON.stringify(state.types), '合計', state.count, '整数保持:', state.allInt);

  // --- スナップ動作（端点にカーソルを寄せる）
  await page.mouse.move(canvas.x + 100, canvas.y + 100);
  await page.waitForTimeout(150);

  // --- 出力系（例外が出ないこと）
  const outs = await page.evaluate(async () => {
    const app = window.cad;
    const res = {};
    const { writeDxf } = await import('/app.js').then(() => ({ writeDxf: null })).catch(() => ({ writeDxf: null }));
    void writeDxf; void res;
    return true;
  });
  void outs;

  // ツールバーの各出力ボタンを押す（ダウンロードは受理するだけ）
  const dl = [];
  page.on('download', (d) => dl.push(d.suggestedFilename()));
  for (const label of ['DXF書出', 'SVG', 'PDF']) {
    await page.locator(`button.tb:text-is("${label}")`).click();
    await page.waitForTimeout(500);
  }
  console.log('ダウンロード:', dl.join(', '));

  // --- 自己診断
  await page.locator('button.tb:text-is("検証")').click();
  await page.waitForTimeout(1500);

  // --- 50,000図形の性能確認
  const perf = await page.evaluate(async () => {
    const app = window.cad;
    const t0 = performance.now();
    app.store.tx('性能試験', () => {
      for (let i = 0; i < 50000; i++) {
        const x = (i % 250) * 20000, y = Math.floor(i / 250) * 20000;
        app.store.add({
          id: 'p' + i, layer: app.doc.currentLayer, color: null, linetype: null, lineweightUm: null,
          created: 0, updated: 0, type: 'line', x1: x, y1: y, x2: x + 15000, y2: y + 10000,
        });
      }
    });
    const build = performance.now() - t0;
    app.zoomExtents();
    const frames = [];
    for (let i = 0; i < 30; i++) {
      const s = performance.now();
      app.vp.panPx(3, 2);
      app.invalidate();
      app.render();
      frames.push(performance.now() - s);
    }
    // 一部を拡大した状態でも測る
    app.vp.scale *= 8;
    const zoomed = [];
    for (let i = 0; i < 30; i++) {
      const s = performance.now();
      app.vp.panPx(3, 2);
      app.invalidate();
      app.render();
      zoomed.push(performance.now() - s);
    }
    const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    return {
      count: app.doc.entities.length,
      buildMs: Math.round(build),
      fullViewMs: +avg(frames).toFixed(1),
      zoomedMs: +avg(zoomed).toFixed(1),
    };
  });
  console.log('性能:', JSON.stringify(perf));

  await page.screenshot({ path: path.join(root, 'docs/screenshot.png'), fullPage: false });
} catch (e) {
  errors.push('例外: ' + (e?.stack ?? e));
} finally {
  await browser?.close();
  server.kill();
}
if (errors.length) {
  console.log('--- エラー ---');
  for (const e of errors.slice(0, 20)) console.log(e);
  process.exitCode = 1;
} else {
  console.log('スモークテスト：エラーなし');
}
