import { emptyDocument } from '../src/model/types.js';
import { mkLine, mkCircle } from '../src/model/doc.js';
import { pt } from '../src/core/geom.js';
import { writeDxf } from '../src/io/dxfwrite.js';
import { readDxf } from '../src/io/dxfread.js';
import { Store } from '../src/model/store.js';
import { solve } from '../src/solver/solver.js';

// --- 5MB規模のDXFを作って読み込み時間を測る（仕様8章 性能要件）
const doc = emptyDocument('性能試験');
for (let i = 0; i < 40000; i++) {
  const x = (i % 200) * 20000, y = Math.floor(i / 200) * 20000;
  doc.entities.push(mkLine(doc, pt(x, y), pt(x + 15000, y + 10000)));
  if (i % 10 === 0) doc.entities.push(mkCircle(doc, pt(x, y), 4000));
}
const t0 = performance.now();
const dxf = writeDxf(doc, { version: '2013' });
const tWrite = performance.now() - t0;
const sizeMB = Buffer.byteLength(dxf) / 1024 / 1024;
const t1 = performance.now();
const back = readDxf(dxf).doc;
const tRead = performance.now() - t1;
const t2 = performance.now();
const store = new Store(back);
const tIndex = performance.now() - t2;
console.log(`DXF: ${sizeMB.toFixed(1)}MB / 図形${doc.entities.length}個`);
console.log(`  書き出し ${tWrite.toFixed(0)}ms / 読み込み ${tRead.toFixed(0)}ms / 索引構築 ${tIndex.toFixed(0)}ms（読込〜表示可能まで ${(tRead + tIndex).toFixed(0)}ms）`);
console.log(`  読み戻し図形数 ${store.doc.entities.length}`);

// --- 拘束200個ちょうどの解決時間
const d2 = emptyDocument();
let n = 0;
const ids: string[][] = [];
for (let k = 0; k < 22; k++) {
  const g: string[] = [];
  for (let i = 0; i < 4; i++) {
    const e = mkLine(d2, pt(k * 150000 + i * 1000, i * 700), pt(k * 150000 + 50000 + i * 900, 30000 + i * 500));
    d2.entities.push(e); g.push(e.id);
  }
  ids.push(g);
}
outer: for (const g of ids) {
  for (let i = 0; i < 4; i++) {
    if (n >= 200) break outer;
    d2.constraints.push({ id: `c${n++}`, type: 'coincident', handles: [{ id: g[i], part: 1 }, { id: g[(i + 1) % 4], part: 0 }], enabled: true });
  }
  for (const [i, t] of [[0, 'horizontal'], [1, 'vertical'], [2, 'horizontal'], [3, 'vertical']] as [number, string][]) {
    if (n >= 200) break outer;
    d2.constraints.push({ id: `c${n++}`, type: t as never, handles: [{ id: g[i], part: 3 }], enabled: true });
  }
}
const runs: number[] = [];
for (let i = 0; i < 5; i++) { const s = performance.now(); solve(d2); runs.push(performance.now() - s); }
console.log(`拘束${d2.constraints.length}個の解決: ${runs.map((r) => r.toFixed(1)).join(' / ')} ms（要件 100ms以内）`);
