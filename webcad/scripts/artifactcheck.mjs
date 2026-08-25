/** Artifact公開時と同じHTML構造で動作確認（downloads capability のスタブ込み） */
import { chromium } from 'playwright';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const file = '/tmp/claude-0/-home-user-TEST/52a62c6c-1c99-5e9b-8b83-1eaeb601e0e6/scratchpad/wrapped.html';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
p.on('dialog', (d) => d.accept());
// claude.use('downloads') を持つホストを再現する
await p.addInitScript(() => {
  window.__saved = [];
  window.claude = {
    use: async (name) => {
      if (name !== 'downloads') return null;
      return {
        save: async ({ filename, data }) => {
          const ext = filename.split('.').pop().toLowerCase();
          const allowed = ['png','txt','json','md','svg','pdf','csv'];
          if (!allowed.includes(ext)) { const e = new Error('rejected'); e.code = 'rejected_extension'; throw e; }
          window.__saved.push({ filename, size: data.size ?? String(data).length });
          return { status: 'saved' };
        },
      };
    },
  };
});
await p.goto('file://' + file);
await p.waitForTimeout(700);
await p.locator('button.tb:text-is("サンプル")').click();
await p.waitForTimeout(600);
// 作図できるか
const cmd = p.locator('#cmdline');
await cmd.fill('L'); await cmd.press('Enter');
await cmd.fill('0,0'); await cmd.press('Enter');
await cmd.fill('@50<45'); await cmd.press('Enter');
await p.keyboard.press('Escape');
// 各種書き出し
for (const label of ['DXF書出', 'SVG', 'PDF']) {
  await p.locator(`button.tb:text-is("${label}")`).click();
  await p.waitForTimeout(600);
}
const state = await p.evaluate(() => ({ n: window.cad.doc.entities.length, saved: window.__saved }));
await p.screenshot({ path: path.join(root, 'docs/artifact-preview.png') });
console.log('図形数:', state.n);
console.log('保存されたファイル:', JSON.stringify(state.saved, null, 0));
console.log(errs.length ? 'エラー: ' + errs.slice(0,5).join(' | ') : 'エラーなし');
await b.close();
if (errs.length) process.exitCode = 1;
