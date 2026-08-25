import { chromium } from 'playwright';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 1600, height: 1140 } });
await p.goto('file://' + path.join(root, 'docs/samples/取付ブラケット.svg'));
await p.waitForTimeout(300);
await p.screenshot({ path: path.join(root, 'docs/svg-output.png') });
// 表題欄を拡大
await p.screenshot({ path: path.join(root, 'docs/titleblock.png'), clip: { x: 850, y: 930, width: 740, height: 190 } });
await b.close();
console.log('SVGを画像化しました');
