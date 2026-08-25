/** dist/（本番ビルド）が正しく動くかの確認 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const server = spawn('node', [path.join(root, 'scripts/dev-server.mjs'), '--dist'], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1000));
const errs = [];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1400, height: 880 } });
p.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('dialog', (d) => d.accept());
await p.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await p.waitForTimeout(600);
await p.locator('button.tb:text-is("サンプル")').click();
await p.waitForTimeout(500);
const cmd = p.locator('#cmdline');
await cmd.fill('C'); await cmd.press('Enter');
await cmd.fill('40,40'); await cmd.press('Enter');
await cmd.fill('@12.5,0'); await cmd.press('Enter');
const state = await p.evaluate(() => ({
  n: window.cad.doc.entities.length,
  r: window.cad.doc.entities.filter((e) => e.type === 'circle').map((c) => c.r),
}));
// 単一ファイル版も配信されているか
const res = await p.request.get('http://localhost:5173/webcad.html');
console.log(`本番ビルド: 図形${state.n}個 / 追加した円の半径 ${state.r.at(-1)}µm（期待12500）/ webcad.html ${res.status()} ${(await res.body()).length}バイト`);
console.log(errs.length ? 'エラー: ' + errs.slice(0, 3).join(' | ') : 'エラーなし');
await b.close(); server.kill();
if (errs.length || state.r.at(-1) !== 12500) process.exitCode = 1;
