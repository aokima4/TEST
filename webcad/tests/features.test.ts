/** 主要機能の動作テスト */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyDocument } from '../src/model/types.js';
import type { LineEnt, ArcEnt, PolylineEnt, DimEnt } from '../src/model/types.js';
import { Store } from '../src/model/store.js';
import { mkLine, mkCircle, mkArc, mkPolyline, entSegs, attachmentAt } from '../src/model/doc.js';
import { pt, dist, angleOf, onCircle, sweepCCW } from '../src/core/geom.js';
import { mmToUm, fmtMM, degToUDeg, UDEG_PER_DEG, roundHalfEven, parseMM } from '../src/core/units.js';
import { trim, extend, offset, fillet, chamfer, join, explode, arrayRect } from '../src/ops/edit.js';
import { readDxf } from '../src/io/dxfread.js';
import { writeDxf } from '../src/io/dxfwrite.js';
import { writeSvg } from '../src/io/svg.js';
import { writePdf } from '../src/io/pdf.js';
import { evalExpr, resolveVars } from '../src/model/expr.js';
import { dimGeometry } from '../src/render/dim.js';
import { buildFrame, buildBom, bomToCsv } from '../src/sheet/frame.js';

const mm = mmToUm;

test('丸めは四捨五入（0.5は偶数側）', () => {
  assert.equal(roundHalfEven(0.5), 0);
  assert.equal(roundHalfEven(1.5), 2);
  assert.equal(roundHalfEven(2.5), 2);
  assert.equal(roundHalfEven(-0.5), 0);
  assert.equal(roundHalfEven(2.4), 2);
});

test('mm入力は厳密な整数µmになる', () => {
  assert.equal(parseMM('100.5'), 100500);
  assert.equal(parseMM('0.001'), 1);
  assert.equal(fmtMM(100500), '100.500');
});

test('トリム：円で切った線が2本に分かれる', () => {
  const doc = emptyDocument();
  const l = mkLine(doc, pt(0, 0), pt(mm(100), 0));
  const c = mkCircle(doc, pt(mm(50), 0), mm(10));
  doc.entities.push(l, c);
  const res = trim(doc, l, [c], pt(mm(50), 0));
  assert.ok(res, 'トリム結果が返ること');
  assert.equal(res!.length, 2);
  const [a, b] = res as LineEnt[];
  assert.equal(a.x2, mm(40));
  assert.equal(b.x1, mm(60));
});

test('延長：線が円まで伸びる', () => {
  const doc = emptyDocument();
  const l = mkLine(doc, pt(0, 0), pt(mm(30), 0));
  const c = mkCircle(doc, pt(mm(50), 0), mm(10));
  doc.entities.push(l, c);
  const res = extend(doc, l, [c], pt(mm(30), 0)) as LineEnt;
  assert.ok(res);
  assert.equal(res.x2, mm(40));
});

test('オフセット：線が指定距離だけ平行移動する', () => {
  const doc = emptyDocument();
  const l = mkLine(doc, pt(0, 0), pt(mm(100), 0));
  doc.entities.push(l);
  const r = offset(doc, l, mm(12.5), pt(mm(50), mm(20))) as LineEnt;
  assert.equal(r.y1, mm(12.5));
  assert.equal(r.y2, mm(12.5));
});

test('オフセット：円は半径が増減する', () => {
  const doc = emptyDocument();
  const c = mkCircle(doc, pt(0, 0), mm(20));
  doc.entities.push(c);
  const outer = offset(doc, c, mm(5), pt(mm(50), 0)) as unknown as { r: number };
  const inner = offset(doc, c, mm(5), pt(0, 0)) as unknown as { r: number };
  assert.equal(outer.r, mm(25));
  assert.equal(inner.r, mm(15));
});

test('フィレット：直角の角がR5の円弧になり、両線が接点まで縮む', () => {
  const doc = emptyDocument();
  const l1 = mkLine(doc, pt(0, 0), pt(mm(100), 0));
  const l2 = mkLine(doc, pt(mm(100), 0), pt(mm(100), mm(80)));
  doc.entities.push(l1, l2);
  const r = fillet(doc, l1, l2, mm(5), pt(mm(10), 0), pt(mm(100), mm(70)));
  assert.ok(r?.arc, '円弧が作られること');
  const arc = r!.arc as ArcEnt;
  assert.equal(arc.r, mm(5));
  assert.equal(arc.cx, mm(95));
  assert.equal(arc.cy, mm(5));
  const n1 = r!.e1 as LineEnt, n2 = r!.e2 as LineEnt;
  assert.equal(n1.x2, mm(95));
  assert.equal(n2.y1, mm(5));
  // 円弧の端点が両線の端点と一致している（＝隙間ゼロ）
  const segs = entSegs(doc, arc);
  const ends = segs[0].kind === 'arc' ? [segs[0].a, segs[0].b] : [];
  const touch = ends.some((p) => dist(p, { x: n1.x2, y: n1.y2 }) <= 1);
  assert.ok(touch, '円弧の端点が線の端点に一致する');
});

test('面取り：角が斜めに落ちる', () => {
  const doc = emptyDocument();
  const l1 = mkLine(doc, pt(0, 0), pt(mm(100), 0));
  const l2 = mkLine(doc, pt(mm(100), 0), pt(mm(100), mm(80)));
  doc.entities.push(l1, l2);
  const r = chamfer(doc, l1, l2, mm(3), mm(3), pt(mm(10), 0), pt(mm(100), mm(70)));
  assert.ok(r);
  assert.equal(r!.line.x1, mm(97));
  assert.equal(r!.line.y2, mm(3));
});

test('結合：4本の線が閉じたポリラインになる', () => {
  const doc = emptyDocument();
  const p = [pt(0, 0), pt(mm(100), 0), pt(mm(100), mm(50)), pt(0, mm(50))];
  const ls = p.map((_, i) => mkLine(doc, p[i], p[(i + 1) % 4]));
  doc.entities.push(...ls);
  const r = join(doc, ls);
  assert.ok(r);
  assert.equal(r!.created.length, 1);
  assert.equal(r!.created[0].closed, true);
  assert.equal(r!.created[0].verts.length, 4);
});

test('分解：ポリラインが線と円弧に分かれる', () => {
  const doc = emptyDocument();
  const pl = mkPolyline(doc, [
    { x: 0, y: 0 }, { x: mm(50), y: 0, bulge: 414214 }, { x: mm(50), y: mm(30) },
  ], false);
  doc.entities.push(pl);
  const parts = explode(doc, pl);
  assert.equal(parts.length, 2);
  assert.equal(parts[0].type, 'line');
  assert.equal(parts[1].type, 'arc');
});

test('矩形状配列複写：3×2で5個増える', () => {
  const doc = emptyDocument();
  const c = mkCircle(doc, pt(0, 0), mm(5));
  doc.entities.push(c);
  const made = arrayRect(doc, [c], 3, 2, mm(20), mm(15));
  assert.equal(made.length, 5);
});

test('寸法は図形の変形に自動追従する（仕様6-1）', () => {
  const doc = emptyDocument();
  const store = new Store(doc);
  const l = store.tx('線', () => store.add(mkLine(doc, pt(0, 0), pt(mm(100), 0)))) as LineEnt;
  const at1 = attachmentAt(doc, l.id, pt(0, 0))!;
  const at2 = attachmentAt(doc, l.id, pt(mm(100), 0))!;
  assert.deepEqual([at1.part, at2.part], [0, 1]);
  const dim: DimEnt = {
    id: 'd1', layer: doc.currentLayer, color: null, linetype: null, lineweightUm: null,
    created: 0, updated: 0, type: 'dim', kind: 'linear-h',
    p1: pt(0, 0), p2: pt(mm(100), 0), p3: pt(mm(50), mm(-15)), refs: [l.id],
    textOverride: null, tol: { mode: 'none' }, th: mm(3.5), arrow: mm(3.5), prefix: '',
    attach1: at1, attach2: at2,
  };
  store.tx('寸法', () => store.add(dim));
  assert.equal(dimGeometry(doc, dim).measured, mm(100));

  // 線の端点を動かす → 寸法の計測点と数値が追従する
  store.addReconciler(() => {
    for (const e of [...doc.entities]) {
      if (e.type !== 'dim') continue;
      const a = e.attach1 && doc.entities.find((x) => x.id === e.attach1!.id) as LineEnt | undefined;
      const b = e.attach2 && doc.entities.find((x) => x.id === e.attach2!.id) as LineEnt | undefined;
      if (!a || !b) continue;
      store.update({ ...e, p1: { x: a.x1, y: a.y1 }, p2: { x: b.x2, y: b.y2 } });
    }
  });
  store.tx('端点移動', () => { store.update({ ...(store.get(l.id) as LineEnt), x2: mm(137.5) }); });
  const after = store.get('d1') as DimEnt;
  assert.equal(dimGeometry(doc, after).measured, mm(137.5));
});

test('DXF：他社CAD風のR12ファイルを読み込める', () => {
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'OUTLINE', '10', '0.0', '20', '0.0', '11', '120.5', '21', '0.0',
    '0', 'CIRCLE', '8', 'OUTLINE', '10', '60.25', '20', '30.0', '40', '12.5',
    '0', 'ARC', '8', '0', '10', '0.0', '20', '0.0', '40', '25.0', '50', '0.0', '51', '90.0',
    '0', 'LWPOLYLINE', '8', '0', '90', '3', '70', '0',
    '10', '0.0', '20', '0.0', '10', '50.0', '20', '0.0', '42', '0.414214', '10', '50.0', '20', '30.0',
    '0', 'TEXT', '8', '0', '10', '5.0', '20', '5.0', '40', '3.5', '1', 'テスト文字',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\r\n') + '\r\n';
  const r = readDxf(dxf);
  const types = r.doc.entities.map((e) => e.type);
  assert.deepEqual(types, ['line', 'circle', 'arc', 'polyline', 'text']);
  const l = r.doc.entities[0] as LineEnt;
  assert.equal(l.x2, mm(120.5));
  assert.equal(l.layer, 'OUTLINE');
  const pl = r.doc.entities[3] as PolylineEnt;
  assert.equal(pl.verts[1].bulge, 414214);
  assert.equal((r.doc.entities[4] as { text: string }).text, 'テスト文字');
});

test('DXF：バルジ付きポリラインが往復しても崩れない', () => {
  const doc = emptyDocument();
  doc.entities.push(mkPolyline(doc, [
    { x: mm(1.5), y: mm(2.25) }, { x: mm(51.5), y: mm(2.25), bulge: -414214 }, { x: mm(51.5), y: mm(32.25) },
  ], true));
  const back = readDxf(writeDxf(doc, { version: '2013' })).doc.entities[0] as PolylineEnt;
  assert.equal(back.verts.length, 3);
  assert.equal(back.verts[1].bulge, -414214);
  assert.equal(back.verts[2].y, mm(32.25));
  assert.equal(back.closed, true);
});

test('SVGは実寸mmで出力される', () => {
  const doc = emptyDocument();
  doc.entities.push(mkLine(doc, pt(0, 0), pt(mm(100), 0)));
  const svg = writeSvg(doc, { bbox: { x1: 0, y1: 0, x2: mm(100), y2: mm(50) }, scaleDen: 1 });
  assert.match(svg, /width="100\.000mm"/);
  assert.match(svg, /height="50\.000mm"/);
  assert.match(svg, /<path /);
});

test('SVGは尺度1:2で紙面が半分になる', () => {
  const doc = emptyDocument();
  doc.entities.push(mkLine(doc, pt(0, 0), pt(mm(100), 0)));
  const svg = writeSvg(doc, { bbox: { x1: 0, y1: 0, x2: mm(100), y2: mm(50) }, scaleDen: 2 });
  assert.match(svg, /width="50\.000mm"/);
});

test('PDFはベクターで生成される', async () => {
  const doc = emptyDocument();
  doc.entities.push(mkLine(doc, pt(0, 0), pt(mm(100), 0)), mkCircle(doc, pt(mm(50), mm(25)), mm(10)));
  const blob = writePdf(doc, { bbox: { x1: 0, y1: 0, x2: mm(420), y2: mm(297) }, paper: 'A3', landscape: true, scaleDen: 1 });
  const text = await blob.text();
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /MediaBox \[0 0 1190\.551 841\.890\]/);
  assert.match(text, / c\n/, '円弧がベジェ曲線で出力される');
  assert.match(text, /%%EOF/);
});

test('計算式：日本語の変数名と依存関係が解ける', () => {
  const r = resolveVars([
    { name: '穴径', expr: '8' },
    { name: '穴ピッチ', expr: '穴径 * 3' },
    { name: 'フチ距離', expr: '穴径 * 1.5' },
  ]);
  assert.equal(r.values['穴ピッチ'], 24);
  assert.equal(r.values['フチ距離'], 12);
  assert.equal(Object.keys(r.errors).length, 0);
});

test('計算式：循環参照を検出する', () => {
  const r = resolveVars([{ name: 'a', expr: 'b + 1' }, { name: 'b', expr: 'a + 1' }]);
  assert.ok(Object.keys(r.errors).length > 0);
});

test('計算式：関数と単位なし演算', () => {
  assert.equal(evalExpr('2 + 3 * 4'), 14);
  assert.equal(evalExpr('sqrt(16)'), 4);
  assert.equal(Math.round(evalExpr('sin(30) * 100')), 50);
});

test('寸法：公差表記が正しく作られる', () => {
  const doc = emptyDocument();
  const base: DimEnt = {
    id: 'd', layer: '0', color: null, linetype: null, lineweightUm: null, created: 0, updated: 0,
    type: 'dim', kind: 'linear-h', p1: pt(0, 0), p2: pt(mm(100), 0), p3: pt(mm(50), mm(-10)),
    refs: [], textOverride: null, tol: { mode: 'sym', sym: mm(0.1) }, th: mm(3.5), arrow: mm(3.5), prefix: '',
  };
  const g = dimGeometry(doc, base);
  assert.equal(g.measured, mm(100));
  assert.match(g.texts[0].text, /^100 ±0\.1$/);
  const fit = dimGeometry(doc, { ...base, tol: { mode: 'fit', fit: 'H7' }, prefix: 'φ' });
  assert.match(fit.texts[0].text, /^φ100 H7$/);
});

test('寸法：角度寸法は鋭角側を測る', () => {
  const doc = emptyDocument();
  const d: DimEnt = {
    id: 'd', layer: '0', color: null, linetype: null, lineweightUm: null, created: 0, updated: 0,
    type: 'dim', kind: 'angular', p1: pt(mm(50), 0), p2: pt(0, mm(50)), p3: pt(mm(20), mm(20)),
    p4: pt(0, 0), refs: [], textOverride: null, tol: { mode: 'none' }, th: mm(3.5), arrow: mm(3.5), prefix: '',
  };
  assert.equal(dimGeometry(doc, d).measured, degToUDeg(90));
});

test('図面枠：A3横は420×297mm、尺度1:2なら図面上は倍', () => {
  const f1 = buildFrame({ size: 'A3', landscape: true, scaleNum: 1, scaleDen: 1, showFrame: true, title: { drawingNo: '', partName: '', material: '', projection: '第三角法', author: '', date: '', revision: '', company: '' } });
  assert.equal(f1.paper.x2, mm(420));
  assert.equal(f1.paper.y2, mm(297));
  const f2 = buildFrame({ size: 'A3', landscape: true, scaleNum: 1, scaleDen: 2, showFrame: true, title: { drawingNo: '', partName: '', material: '', projection: '第三角法', author: '', date: '', revision: '', company: '' } });
  assert.equal(f2.paper.x2, mm(840));
});

test('部品表：ブロックの員数が集計されCSVになる', () => {
  const doc = emptyDocument();
  doc.blocks['M8穴'] = { name: 'M8穴', baseX: 0, baseY: 0, entities: [], attrs: { name: 'M8穴', material: 'SS400' } };
  for (let i = 0; i < 20; i++) {
    doc.entities.push({
      id: `i${i}`, layer: '0', color: null, linetype: null, lineweightUm: null, created: 0, updated: 0,
      type: 'insert', block: 'M8穴', x: i * mm(20), y: 0, sx: 1e6, sy: 1e6, rot: 0,
    });
  }
  const rows = buildBom(doc);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 20);
  assert.match(bomToCsv(rows), /M8穴/);
});

test('ブロック：中身を1回変えると貼った全箇所が変わる（仕様3-3）', () => {
  const doc = emptyDocument();
  doc.blocks['穴'] = { name: '穴', baseX: 0, baseY: 0, entities: [mkCircle(doc, pt(0, 0), mm(4))], attrs: {} };
  for (let i = 0; i < 20; i++) {
    doc.entities.push({
      id: `i${i}`, layer: '0', color: null, linetype: null, lineweightUm: null, created: 0, updated: 0,
      type: 'insert', block: '穴', x: i * mm(20), y: 0, sx: 1e6, sy: 1e6, rot: 0,
    });
  }
  const before = entSegs(doc, doc.entities[0]);
  assert.equal(before[0].kind === 'arc' ? before[0].r : 0, mm(4));
  // ブロック定義を M10 相当（半径5）に変更
  doc.blocks['穴'].entities = [mkCircle(doc, pt(0, 0), mm(5))];
  for (const e of doc.entities) {
    const s = entSegs(doc, e);
    assert.equal(s[0].kind === 'arc' ? s[0].r : 0, mm(5));
  }
});

test('円弧の向きと掃引角が保たれる', () => {
  const doc = emptyDocument();
  const a = mkArc(doc, pt(0, 0), mm(20), degToUDeg(350), degToUDeg(10));
  assert.equal(sweepCCW(a.a1, a.a2), degToUDeg(20));
  const p = onCircle(pt(0, 0), mm(20), a.a2);
  // 座標は1µm整数に丸められるため、半径は1µm以内・角度は丸め由来の誤差内で一致する
  assert.ok(Math.abs(dist(pt(0, 0), p) - mm(20)) <= 1, '端点が円周上にある');
  assert.ok(Math.abs(angleOf(pt(0, 0), p) - degToUDeg(10)) <= 3000, '角度誤差 0.003度以内');
});

test('Undo/Redoでレイヤ変更も戻る', () => {
  const doc = emptyDocument();
  const store = new Store(doc);
  const before = doc.layers.length;
  store.tx('レイヤ追加', () => {
    store.touchMeta();
    doc.layers.push({ name: 'テスト', color: '#fff', linetype: 'CONTINUOUS', lineweightUm: 250, visible: true, locked: false, printable: true });
  });
  assert.equal(store.doc.layers.length, before + 1);
  store.undo();
  assert.equal(store.doc.layers.length, before);
  store.redo();
  assert.equal(store.doc.layers.length, before + 1);
});

test('図形を消すと、その図形を参照する寸法も一緒に消える', () => {
  const doc = emptyDocument();
  const store = new Store(doc);
  const l = store.tx('線', () => store.add(mkLine(doc, pt(0, 0), pt(mm(50), 0))));
  store.tx('寸法', () => store.add({
    id: 'd1', layer: '0', color: null, linetype: null, lineweightUm: null, created: 0, updated: 0,
    type: 'dim', kind: 'linear-h', p1: pt(0, 0), p2: pt(mm(50), 0), p3: pt(mm(25), mm(-10)),
    refs: [l.id], textOverride: null, tol: { mode: 'none' }, th: mm(3.5), arrow: mm(3.5), prefix: '',
  }));
  assert.equal(doc.entities.length, 2);
  store.tx('削除', () => store.remove(l.id));
  assert.equal(doc.entities.length, 0);
  store.undo();
  assert.equal(doc.entities.length, 2);
});
