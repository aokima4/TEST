/** 生成したPDFの構造検査（xrefのオフセットが正しいか） */
import { readFile } from 'node:fs/promises';
const buf = await readFile('docs/samples/取付ブラケット.pdf');
const s = buf.toString('latin1');
const startxref = Number(s.slice(s.lastIndexOf('startxref') + 9).trim().split(/\s/)[0]);
const xref = s.slice(startxref);
if (!xref.startsWith('xref')) throw new Error('startxref が xref を指していない');
const lines = xref.split('\n');
const [first, count] = lines[1].trim().split(' ').map(Number);
let ok = 0;
for (let i = 1; i < count; i++) {
  const off = Number(lines[1 + i + 1].slice(0, 10));
  const at = s.slice(off, off + 20);
  if (!new RegExp(`^${first + i} 0 obj`).test(at)) throw new Error(`オブジェクト${first + i}のオフセットが不正: ${JSON.stringify(at)}`);
  ok++;
}
const pages = (s.match(/\/Type \/Page[^s]/g) ?? []).length;
const hasStream = /stream\n[\s\S]*?endstream/.test(s);
const streamLen = Number(/\/Length (\d+)/.exec(s)?.[1] ?? 0);
const actual = s.slice(s.indexOf('stream\n') + 7, s.indexOf('\nendstream')).length;
console.log(`PDF検査: オブジェクト${ok}件のオフセット一致 / ページ数 ${pages} / 内容ストリーム ${hasStream ? 'あり' : 'なし'} / Length宣言 ${streamLen} = 実際 ${actual} ${streamLen === actual ? '✓' : '✗'}`);
if (streamLen !== actual) process.exitCode = 1;
