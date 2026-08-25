/** 動作確認用のサンプル図面（取付ブラケット）を組み立てる */
import type { CadDocument, Entity } from '../model/types.js';
import { emptyDocument } from '../model/types.js';
import { mkLine, mkCircle, mkArc, mkPolyline, mkText, mkCommon } from '../model/doc.js';
import { pt } from '../core/geom.js';
import { mmToUm, degToUDeg, UDEG_PER_DEG } from '../core/units.js';

const mm = mmToUm;

export function sampleDrawing(): CadDocument {
  const doc = emptyDocument('取付ブラケット');
  doc.sheet = {
    ...doc.sheet, size: 'A3', landscape: true, scaleNum: 1, scaleDen: 1, showFrame: true,
    title: {
      drawingNo: 'BRK-1024', partName: '取付ブラケット', material: 'SS400',
      projection: '第三角法', author: '設計部', date: new Date().toLocaleDateString('ja-JP'),
      revision: 'A', company: '株式会社サンプル製作所',
    },
  };
  doc.variables = [
    { name: '板厚', expr: '6' },
    { name: '穴径', expr: '9' },
    { name: '穴ピッチ', expr: '穴径 * 8' },
    { name: 'フチ距離', expr: '穴径 * 1.6' },
  ];

  const add = (e: Entity): Entity => { doc.entities.push(e); return e; };
  const O = { x: mm(60), y: mm(120) };   // 図面上の基準位置
  const W = mm(120), H = mm(80), R = mm(10);

  // --- 外形（角R10のポリライン）
  const b = mmToUm.bind(null);
  void b;
  const x0 = O.x, y0 = O.y, x1 = O.x + W, y1 = O.y + H;
  const bulge90 = 414214;    // tan(90°/4)×10^6 = 反時計回りの1/4円（角R）
  add(mkPolyline(doc, [
    { x: x0 + R, y: y0 },
    { x: x1 - R, y: y0, bulge: bulge90 },
    { x: x1, y: y0 + R },
    { x: x1, y: y1 - R, bulge: bulge90 },
    { x: x1 - R, y: y1 },
    { x: x0 + R, y: y1, bulge: bulge90 },
    { x: x0, y: y1 - R },
    { x: x0, y: y0 + R, bulge: bulge90 },
  ], true, '外形線'));

  // --- 取付穴 2つ（φ9）＋ 中心線
  const holes = [
    { x: x0 + mm(24), y: y0 + mm(40) },
    { x: x0 + mm(96), y: y0 + mm(40) },
  ];
  for (const h of holes) {
    add(mkCircle(doc, pt(h.x, h.y), mm(4.5), '外形線'));
    add(mkLine(doc, pt(h.x - mm(8), h.y), pt(h.x + mm(8), h.y), '中心線'));
    add(mkLine(doc, pt(h.x, h.y - mm(8)), pt(h.x, h.y + mm(8)), '中心線'));
  }
  // --- 中央の長穴（U溝）
  const slotY = y0 + mm(40);
  add(mkArc(doc, pt(x0 + mm(52), slotY), mm(6), degToUDeg(90), degToUDeg(270), '外形線'));
  add(mkArc(doc, pt(x0 + mm(68), slotY), mm(6), degToUDeg(270), degToUDeg(90), '外形線'));
  add(mkLine(doc, pt(x0 + mm(52), slotY + mm(6)), pt(x0 + mm(68), slotY + mm(6)), '外形線'));
  add(mkLine(doc, pt(x0 + mm(52), slotY - mm(6)), pt(x0 + mm(68), slotY - mm(6)), '外形線'));
  add(mkLine(doc, pt(x0 + mm(44), slotY), pt(x0 + mm(76), slotY), '中心線'));

  // --- 寸法
  const dim = (kind: 'linear-h' | 'linear-v' | 'diameter' | 'radius', p1: { x: number; y: number }, p2: { x: number; y: number }, p3: { x: number; y: number }, prefix = '', tol?: { mode: 'sym' | 'fit' | 'dev'; sym?: number; fit?: string }): void => {
    doc.entities.push({
      ...mkCommon(doc, { layer: '寸法' }), type: 'dim', kind,
      p1, p2, p3, refs: [], textOverride: null,
      tol: (tol ?? { mode: 'none' }) as never, th: mm(3.5), arrow: mm(3.5), prefix,
    });
  };
  dim('linear-h', pt(x0, y0), pt(x1, y0), pt(x0 + W / 2, y0 - mm(18)));
  dim('linear-v', pt(x1, y0), pt(x1, y1), pt(x1 + mm(18), y0 + H / 2));
  dim('linear-h', pt(holes[0].x, holes[0].y), pt(holes[1].x, holes[1].y), pt(x0 + W / 2, y1 + mm(14)),
    '', { mode: 'sym', sym: mm(0.1) });
  dim('diameter', pt(holes[0].x, holes[0].y), pt(holes[0].x + mm(4.5), holes[0].y), pt(holes[0].x - mm(26), holes[0].y + mm(26)), 'φ',
    { mode: 'fit', fit: 'H7' });
  dim('linear-v', pt(x0, y0), pt(x0, holes[0].y), pt(x0 - mm(16), y0 + mm(20)));

  // --- 幾何公差（位置度）と表面粗さ・引出線
  doc.entities.push({
    ...mkCommon(doc, { layer: '寸法' }), type: 'gtol',
    x: x0 + mm(20), y: y0 - mm(34), h: mm(3.5),
    symbol: 'position', tolerance: 'φ0.2', datums: ['A', 'B'],
    leader: pt(holes[0].x, holes[0].y - mm(4.5)),
  });
  doc.entities.push({
    ...mkCommon(doc, { layer: '寸法' }), type: 'surf',
    x: x1 - mm(24), y: y1 + mm(4), h: mm(3), kind: 'remove', value: 'Ra1.6', note: '', rot: 0,
  });
  doc.entities.push({
    ...mkCommon(doc, { layer: '寸法' }), type: 'leader',
    from: pt(x0 + mm(60), slotY + mm(6)), to: pt(x0 + mm(78), y1 + mm(20)),
    text: '長穴 12×28', h: mm(3.5), arrow: mm(3.5),
  });

  // --- 断面図（右側）：ハッチング付き
  const sx = x1 + mm(60);
  const sec = mkPolyline(doc, [
    { x: sx, y: y0 }, { x: sx + mm(6), y: y0 }, { x: sx + mm(6), y: y1 }, { x: sx, y: y1 },
  ], true, '外形線');
  add(sec);
  doc.entities.push({
    ...mkCommon(doc, { layer: 'ハッチング' }), type: 'hatch',
    boundary: [sec.id], pattern: 'ANSI31', angle: degToUDeg(45), spacing: mm(2.5),
  });
  dim('linear-h', pt(sx, y0), pt(sx + mm(6), y0), pt(sx + mm(3), y0 - mm(18)), 't');
  add(mkText(doc, pt(sx - mm(4), y1 + mm(12)), '断面 A-A', mm(5), 0, '寸法'));
  add(mkText(doc, pt(x0, y1 + mm(34)), '材質 SS400 / 板厚 6 / 指示なき角部 C0.5', mm(4), 0, '寸法'));

  void UDEG_PER_DEG;
  doc.nextId = doc.entities.length + 100;
  return doc;
}
