import { writeFile, mkdir } from 'node:fs/promises';
import { sampleDrawing } from '../src/app/sample.js';
import { writeDxf } from '../src/io/dxfwrite.js';
import { readDxf } from '../src/io/dxfread.js';
import { writeSvg } from '../src/io/svg.js';
import { writePdf } from '../src/io/pdf.js';
import { toJson } from '../src/io/xcad.js';
import { buildFrame } from '../src/sheet/frame.js';
import { docBBox } from '../src/model/doc.js';

const doc = sampleDrawing();
const frame = buildFrame(doc.sheet);
await mkdir('docs/samples', { recursive: true });

for (const ver of ['2013', 'R12'] as const) {
  const dxf = writeDxf(doc, { version: ver });
  await writeFile(`docs/samples/取付ブラケット_${ver}.dxf`, dxf, 'utf8');
  const back = readDxf(dxf).doc;
  const counts: Record<string, number> = {};
  for (const e of back.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
  console.log(`DXF ${ver}: ${(dxf.length / 1024).toFixed(0)}KB → 読み戻し ${back.entities.length}図形`, JSON.stringify(counts));
}

const svg = writeSvg(doc, { bbox: frame.paper, scaleDen: 1, extra: frame.entities, background: '#ffffff', monochrome: true });
await writeFile('docs/samples/取付ブラケット.svg', svg, 'utf8');
console.log(`SVG: ${(svg.length / 1024).toFixed(0)}KB`);

const pdf = writePdf(doc, { bbox: frame.paper, paper: 'A3', landscape: true, scaleDen: 1, extra: frame.entities, monochrome: true, title: doc.name });
const buf = Buffer.from(await pdf.arrayBuffer());
await writeFile('docs/samples/取付ブラケット.pdf', buf);
console.log(`PDF: ${(buf.length / 1024).toFixed(0)}KB`);

await writeFile('docs/samples/取付ブラケット.xcad.json', toJson(doc), 'utf8');
const b = docBBox(doc);
console.log(`図面範囲: ${(b.x1 / 1000).toFixed(1)},${(b.y1 / 1000).toFixed(1)} 〜 ${(b.x2 / 1000).toFixed(1)},${(b.y2 / 1000).toFixed(1)} mm`);
