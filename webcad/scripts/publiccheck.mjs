/** 公開版（downloads capability なし・iframe埋め込み）での書き出し動作を確認する */
import { chromium } from 'playwright';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const inner = '/tmp/claude-0/-home-user-TEST/52a62c6c-1c99-5e9b-8b83-1eaeb601e0e6/scratchpad/wrapped.html';
const outer = '/tmp/claude-0/-home-user-TEST/52a62c6c-1c99-5e9b-8b83-1eaeb601e0e6/scratchpad/outer.html';
const { writeFile } = await import('node:fs/promises');
await writeFile(outer, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%}</style><iframe src="file://${inner}"></iframe>`);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? '150' : undefined));
await page.goto('file://' + outer);
const f = page.frameLocator('iframe');
await page.waitForTimeout(800);
await f.locator('button.tb:text-is("サンプル")').click();
await page.waitForTimeout(500);

// DXF書出 → コピー画面が出るか
await f.locator('button.tb:text-is("DXF書出")').click();
await page.waitForTimeout(600);
const hasText = await f.locator('.exporttext').count();
const head = hasText ? (await f.locator('.exporttext').inputValue()).slice(0, 40).replace(/\r?\n/g, '⏎') : '';
console.log(`DXF: 書き出し画面 ${hasText ? 'あり' : 'なし'} / 冒頭 "${head}"`);
await f.locator('.modalhead button').click();

// PNG → 画像プレビューが出るか
await f.locator('button.tb:text-is("PNG")').click();
await page.waitForTimeout(1200);
const hasImg = await f.locator('.exportimg').count();
console.log(`PNG: 画像プレビュー ${hasImg ? 'あり' : 'なし'}`);
await f.locator('.exportimg').screenshot({ path: path.join(root, 'docs/png-export.png') });
await page.screenshot({ path: path.join(root, 'docs/export-fallback.png') });
if (hasImg) await f.locator('.modalhead button').click();

console.log(errs.length ? 'エラー: ' + errs.slice(0, 3).join(' | ') : 'エラーなし');
await b.close();
if (!hasText || !hasImg || errs.length) process.exitCode = 1;
