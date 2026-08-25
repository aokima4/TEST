/** マウスのクリックだけで各コマンドが完了するかを確認する */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const server = spawn('node', [path.join(root, 'scripts/dev-server.mjs')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const errs = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('dialog', (d) => d.accept());
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(400);
await p.evaluate(() => { const a = window.cad; a.vp.scale = 0.002; a.vp.cx = 150000; a.vp.cy = 105000; a.invalidate(); });
const S = (wx, wy) => p.evaluate(([x, y]) => {
  const a = window.cad, r = a.canvas.getBoundingClientRect();
  return { x: r.left + a.vp.sx(x), y: r.top + a.vp.sy(y) };
}, [wx, wy]);
const clickAt = async (wx, wy) => { const s = await S(wx, wy); await p.mouse.move(s.x, s.y); await p.waitForTimeout(60); await p.mouse.click(s.x, s.y); await p.waitForTimeout(60); };
const tool = async (name) => { await p.locator(`button.tool[data-cmd="${name}"]`).click(); await p.waitForTimeout(80); };
const count = (t) => p.evaluate((ty) => window.cad.doc.entities.filter((e) => e.type === ty).length, t);
const results = [];

// 円：ツールを押して2回クリックするだけ
await tool('円');
await clickAt(60000, 100000);
await clickAt(85000, 100000);
results.push(['円（中心→半径）', await count('circle'), 1]);
const r0 = await p.evaluate(() => window.cad.doc.entities.find((e) => e.type === 'circle')?.r);

// 円弧：3回クリック
await tool('円弧');
await clickAt(120000, 90000);
await clickAt(140000, 110000);
await clickAt(160000, 90000);
results.push(['円弧（3点）', await count('arc'), 1]);

// 線
await tool('線');
await clickAt(30000, 40000);
await clickAt(90000, 40000);
await p.keyboard.press('Escape');
results.push(['線', await count('line'), 1]);

// 矩形
await tool('矩形');
await clickAt(180000, 60000);
await clickAt(240000, 120000);
results.push(['矩形', await count('polyline'), 1]);

// 正多角形（辺数は既定6のまま、クリックだけで進む）
await tool('正多角形');
await clickAt(60000, 160000);
await clickAt(85000, 160000);
results.push(['正多角形', await count('polyline'), 2]);

// 直径寸法：円をクリック→位置クリック
await tool('直径寸法');
await clickAt(85000, 100000);
await clickAt(60000, 135000);
results.push(['直径寸法', await count('dim'), 1]);

console.log(`半径: ${r0}µm（期待 25000）`);
for (const [name, got, want] of results) {
  console.log(`${got === want ? '✅' : '❌'} ${name}: ${got}個（期待 ${want}）`);
  if (got !== want) errs.push(`${name} がクリックだけで完了しない`);
}
await p.screenshot({ path: path.join(root, 'docs/mousecheck.png') });
await b.close(); server.kill();
if (errs.length) { console.log('--- 問題 ---'); errs.slice(0, 6).forEach((e) => console.log(e)); process.exitCode = 1; }
else console.log('マウス操作だけで全コマンド完了');
