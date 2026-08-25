/** マウス操作・スナップ・グリップ編集・拘束の動作確認 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const server = spawn('node', [path.join(root, 'scripts/dev-server.mjs')], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const errors = [];
let browser;
const log = (...a) => console.log(...a);

try {
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const cmd = page.locator('#cmdline');
  const W = async (fn, arg) => page.evaluate(fn, arg);

  // 図面全体をmmで見やすい倍率に固定
  await W(() => { const a = window.cad; a.vp.scale = 2.0 / 1000 * 1.0; a.vp.cx = 150000; a.vp.cy = 100000; a.invalidate(); });

  // ---- 1. マウスで矩形を描き、端点スナップで線を引く
  await cmd.fill('REC'); await cmd.press('Enter');
  await cmd.fill('0,0'); await cmd.press('Enter');
  await cmd.fill('120,80'); await cmd.press('Enter');

  const screenOf = (x, y) => W(([wx, wy]) => {
    const a = window.cad;
    const r = a.canvas.getBoundingClientRect();
    return { x: r.left + a.vp.sx(wx), y: r.top + a.vp.sy(wy) };
  }, [x, y]);

  // 端点(120,80)の少し外側にカーソル → 端点スナップが効くか
  const near = await screenOf(120000 + 300, 80000 + 300);
  await page.mouse.move(near.x, near.y);
  await page.waitForTimeout(120);
  const snap = await W(() => window.cad.snapHit && { type: window.cad.snapHit.type, p: window.cad.snapHit.p });
  log('スナップ:', JSON.stringify(snap));
  if (!snap || snap.type !== 'endpoint' || snap.p.x !== 120000 || snap.p.y !== 80000) {
    errors.push('端点スナップが効いていない: ' + JSON.stringify(snap));
  }

  // ---- 2. マウスクリックで線を引く（スナップ点で確定されるか）
  await cmd.fill('L'); await cmd.press('Enter');
  await page.mouse.click(near.x, near.y);
  const origin = await screenOf(500, 500);
  await page.mouse.move(origin.x, origin.y);
  await page.waitForTimeout(100);
  await page.mouse.click(origin.x, origin.y);
  await page.keyboard.press('Escape');
  const diag = await W(() => {
    const l = window.cad.doc.entities.find((e) => e.type === 'line');
    return l && [l.x1, l.y1, l.x2, l.y2];
  });
  log('対角線:', JSON.stringify(diag));
  if (!diag || diag[0] !== 120000 || diag[1] !== 80000 || diag[2] !== 0 || diag[3] !== 0) {
    errors.push('スナップ点でクリック確定できていない: ' + JSON.stringify(diag));
  }

  // ---- 3. 円を2つ + 直径寸法
  await cmd.fill('C'); await cmd.press('Enter'); await cmd.fill('C'); await cmd.press('Enter');
  await cmd.fill('30,40'); await cmd.press('Enter'); await cmd.fill('@9,0'); await cmd.press('Enter');
  await cmd.fill('C'); await cmd.press('Enter'); await cmd.fill('C'); await cmd.press('Enter');
  await cmd.fill('90,40'); await cmd.press('Enter'); await cmd.fill('@9,0'); await cmd.press('Enter');
  await cmd.fill('DDI'); await cmd.press('Enter');
  const onCirc = await screenOf(30000 + 9000, 40000);
  await page.mouse.move(onCirc.x, onCirc.y); await page.waitForTimeout(80);
  await page.mouse.click(onCirc.x, onCirc.y);
  const dimPos = await screenOf(52000, 62000);
  await page.mouse.move(dimPos.x, dimPos.y); await page.waitForTimeout(80);
  await page.mouse.click(dimPos.x, dimPos.y);

  // ---- 4. 長さ寸法（端点スナップで関連付け）
  await cmd.fill('DLI'); await cmd.press('Enter');
  const c1 = await screenOf(0, 0), c2 = await screenOf(120000, 0);
  await page.mouse.move(c1.x, c1.y); await page.waitForTimeout(80); await page.mouse.click(c1.x, c1.y);
  await page.mouse.move(c2.x, c2.y); await page.waitForTimeout(80); await page.mouse.click(c2.x, c2.y);
  const below = await screenOf(60000, -20000);
  await page.mouse.move(below.x, below.y); await page.waitForTimeout(80); await page.mouse.click(below.x, below.y);

  const dims = await W(() => window.cad.doc.entities.filter((e) => e.type === 'dim').map((d) => ({ kind: d.kind, attach: !!d.attach1, p1: d.p1, p2: d.p2 })));
  log('寸法:', JSON.stringify(dims));

  // ---- 5. 寸法の追従：ポリラインの頂点を動かして寸法値が変わるか
  const measured = await W(async () => {
    const a = window.cad;
    const dim = a.doc.entities.find((e) => e.type === 'dim' && e.kind !== 'diameter');
    const mod = await import('/app.js').catch(() => null);
    void mod;
    return dim ? [dim.p1.x, dim.p2.x, !!dim.attach1, !!dim.attach2] : null;
  });
  log('寸法の関連付け:', JSON.stringify(measured));

  // ---- 6. Undo/Redo
  const before = await W(() => window.cad.doc.entities.length);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  const afterUndo = await W(() => window.cad.doc.entities.length);
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  const afterRedo = await W(() => window.cad.doc.entities.length);
  log(`Undo/Redo: ${before} → ${afterUndo} → ${afterRedo}`);
  if (afterRedo !== before) errors.push('Undo/Redoで図形数が戻らない');

  // ---- 7. グリップ編集（矩形の頂点をドラッグ）
  await W(() => {
    const a = window.cad;
    const pl = a.doc.entities.find((e) => e.type === 'polyline');
    a.selection.clear(); a.selection.add(pl.id); a.invalidate();
  });
  const gripFrom = await screenOf(120000, 80000);
  const gripTo = await screenOf(140000, 90000);
  await page.mouse.move(gripFrom.x, gripFrom.y);
  await page.mouse.down();
  await page.mouse.move(gripTo.x, gripTo.y, { steps: 6 });
  await page.mouse.up();
  const vert = await W(() => {
    const pl = window.cad.doc.entities.find((e) => e.type === 'polyline');
    return pl.verts.map((v) => [v.x, v.y]);
  });
  log('グリップ編集後の頂点:', JSON.stringify(vert));
  const moved = vert.some(([x, y]) => x === 140000 && y === 90000);
  if (!moved) errors.push('グリップ編集が反映されていない: ' + JSON.stringify(vert));
  // 1手順で戻せるか
  const undoLabel = await W(() => window.cad.store.undoLabel);
  await page.keyboard.press('Control+z');
  const restored = await W(() => {
    const pl = window.cad.doc.entities.find((e) => e.type === 'polyline');
    return pl.verts.some((v) => v.x === 120000 && v.y === 80000);
  });
  log(`Undo(${undoLabel})で復元:`, restored);
  if (!restored) errors.push('グリップ編集が1手順で戻らない');
  await page.keyboard.press('Control+y');

  // ---- 8. 拘束：円を同心にして寸法拘束
  await W(() => { window.cad.selection.clear(); window.cad.invalidate(); });
  await cmd.fill('DCR'); await cmd.press('Enter');
  const circleEdge = await screenOf(90000 + 9000, 40000);
  await page.mouse.move(circleEdge.x, circleEdge.y); await page.waitForTimeout(80);
  await page.mouse.click(circleEdge.x, circleEdge.y);
  await cmd.fill('12.5'); await cmd.press('Enter');
  await page.waitForTimeout(300);
  const radius = await W(() => {
    const cs = window.cad.doc.entities.filter((e) => e.type === 'circle');
    return { radii: cs.map((c) => c.r), constraints: window.cad.doc.constraints.length, msg: window.cad.solverMsg };
  });
  log('半径拘束の結果:', JSON.stringify(radius));
  if (!radius.radii.includes(12500)) errors.push('半径拘束が反映されていない: ' + JSON.stringify(radius));

  // ---- 9. 変数＋式による寸法拘束
  await W(() => {
    const a = window.cad;
    a.store.tx('変数', () => { a.store.touchMeta(); a.doc.variables.push({ name: '穴径', expr: '8' }); });
    a.resolveVariables();
  });
  await cmd.fill('DCR'); await cmd.press('Enter');
  const c1e = await screenOf(30000 + 9000, 40000);
  await page.mouse.move(c1e.x, c1e.y); await page.waitForTimeout(80);
  await page.mouse.click(c1e.x, c1e.y);
  await cmd.fill('穴径 / 2 * 1.5'); await cmd.press('Enter');
  await page.waitForTimeout(300);
  const r2 = await W(() => window.cad.doc.entities.filter((e) => e.type === 'circle').map((c) => c.r));
  log('式による半径:', JSON.stringify(r2), '（期待 6000µm を含む）');
  if (!r2.includes(6000)) errors.push('式による寸法拘束が効いていない: ' + JSON.stringify(r2));

  // ---- 10. 表題欄に記入して図面枠つきで表示
  await W(() => {
    const a = window.cad;
    a.store.tx('表題欄', () => {
      a.store.touchMeta();
      Object.assign(a.doc.sheet.title, {
        drawingNo: 'A-1024', partName: '取付ブラケット', material: 'SS400',
        author: '設計部', date: '2026-08-25', company: '株式会社サンプル製作所',
      });
      a.doc.name = '取付ブラケット';
    });
    a.zoomExtents();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(root, 'docs/screenshot.png') });

  const summary = await W(() => {
    const a = window.cad;
    const t = {};
    for (const e of a.doc.entities) t[e.type] = (t[e.type] ?? 0) + 1;
    return { types: t, constraints: a.doc.constraints.length, solver: a.solverMsg };
  });
  log('最終状態:', JSON.stringify(summary));
} catch (e) {
  errors.push('例外: ' + (e?.stack ?? e));
} finally {
  await browser?.close();
  server.kill();
}
if (errors.length) { console.log('--- エラー ---'); errors.slice(0, 10).forEach((e) => console.log(e)); process.exitCode = 1; }
else console.log('操作テスト：すべて期待どおり');
