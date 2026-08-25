import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const server = spawn('node', [path.join(root, 'scripts/dev-server.mjs')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on('dialog', (d) => d.accept());
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('button.tb:text-is("サンプル")').click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(root, 'docs/screenshot.png') });
// 図面部分だけ拡大したショット
await page.evaluate(() => { const a = window.cad; a.vp.fit({ x1: 30000, y1: 70000, x2: 260000, y2: 230000 }); a.invalidate(); });
await page.waitForTimeout(400);
await page.locator('#canvasWrap').screenshot({ path: path.join(root, 'docs/drawing.png') });
// SVG / DXF / PDF を実ファイルとして保存
const outs = await page.evaluate(async () => {
  const a = window.cad;
  const m = await import('/app.js');
  void m;
  return { entities: a.doc.entities.length, types: [...new Set(a.doc.entities.map((e) => e.type))] };
});
console.log(JSON.stringify(outs), errs.length ? 'ERRORS:' + errs.join('|') : 'ok');
await browser.close(); server.kill();
