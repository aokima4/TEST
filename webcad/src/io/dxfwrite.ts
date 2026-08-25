/**
 * DXF 書き出し（仕様 7-1）
 * - AutoCAD R12 形式（AC1009）と 2013 形式（AC1027, ASCII）の両対応
 * - 座標は mm・小数点以下6桁で出力。内部はµm整数なので 6 桁あれば完全に無損失。
 */
import type { CadDocument, Entity, LineTypeName, Layer } from '../model/types.js';
import { polySegs, explodeInsert, entSegs, docBBox } from '../model/doc.js';
import { dimGeometry } from '../render/dim.js';
import type { DimGeom } from '../render/dim.js';
import { annotGeometry } from '../render/annot.js';
import { UM_PER_MM, UDEG_PER_DEG } from '../core/units.js';
import { hexToAci, hexToTrueColor } from './aci.js';
import { entityToPolygon } from '../render/painter.js';
import { sweepCCW, polar, onCircle } from '../core/geom.js';
import type { Pt } from '../core/geom.js';

export type DxfVersion = 'R12' | '2013';

const LTYPE_DEFS: Record<LineTypeName, { desc: string; pattern: number[] }> = {
  CONTINUOUS: { desc: 'Solid line', pattern: [] },
  HIDDEN: { desc: 'Hidden __ __ __ __', pattern: [3, -1.5] },
  CENTER: { desc: 'Center ____ _ ____', pattern: [10, -1.5, 2, -1.5] },
  PHANTOM: { desc: 'Phantom ____ _ _ ____', pattern: [10, -1.5, 2, -1.5, 2, -1.5] },
};

class Writer {
  private out: string[] = [];
  private handle = 0x100;

  g(code: number, value: string | number): void {
    this.out.push(String(code));
    this.out.push(typeof value === 'number' ? String(value) : value);
  }
  /** mm へ変換して6桁固定で出力（µm整数 → 完全に無損失） */
  coord(code: number, um: number): void {
    this.g(code, (um / UM_PER_MM).toFixed(6));
  }
  ang(code: number, udeg: number): void {
    this.g(code, (udeg / UDEG_PER_DEG).toFixed(6));
  }
  nextHandle(): string {
    return (this.handle++).toString(16).toUpperCase();
  }
  text(): string { return this.out.join('\r\n') + '\r\n'; }
}

export interface DxfWriteOptions {
  version?: DxfVersion;
  /** 寸法を線と文字に分解して出力（他社CADでの互換性が最も高い） */
  explodeDims?: boolean;
}

export function writeDxf(doc: CadDocument, opts: DxfWriteOptions = {}): string {
  const ver: DxfVersion = opts.version ?? '2013';
  const w = new Writer();
  const v2013 = ver === '2013';
  const explodeDims = opts.explodeDims ?? true;

  const bbox = docBBox(doc);
  const has = Number.isFinite(bbox.x1);

  // ---------------- HEADER
  w.g(0, 'SECTION'); w.g(2, 'HEADER');
  w.g(9, '$ACADVER'); w.g(1, v2013 ? 'AC1027' : 'AC1009');
  w.g(9, '$INSUNITS'); w.g(70, 4);                     // 4 = ミリメートル
  w.g(9, '$MEASUREMENT'); w.g(70, 1);                  // 1 = メートル法
  w.g(9, '$LUNITS'); w.g(70, 2);
  w.g(9, '$LUPREC'); w.g(70, 6);
  w.g(9, '$EXTMIN'); w.coord(10, has ? bbox.x1 : 0); w.coord(20, has ? bbox.y1 : 0); w.coord(30, 0);
  w.g(9, '$EXTMAX'); w.coord(10, has ? bbox.x2 : 0); w.coord(20, has ? bbox.y2 : 0); w.coord(30, 0);
  if (v2013) { w.g(9, '$HANDSEED'); w.g(5, 'FFFF'); }
  w.g(0, 'ENDSEC');

  // ---------------- TABLES
  w.g(0, 'SECTION'); w.g(2, 'TABLES');

  // LTYPE
  w.g(0, 'TABLE'); w.g(2, 'LTYPE');
  if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTable'); }
  w.g(70, 4 + Object.keys(LTYPE_DEFS).length);
  for (const [name, def] of Object.entries(LTYPE_DEFS) as [LineTypeName, { desc: string; pattern: number[] }][]) {
    w.g(0, 'LTYPE');
    if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbLinetypeTableRecord'); }
    w.g(2, name); w.g(70, 0); w.g(3, def.desc); w.g(72, 65);
    w.g(73, def.pattern.length);
    w.g(40, def.pattern.reduce((s, v) => s + Math.abs(v), 0).toFixed(6));
    for (const p of def.pattern) w.g(49, p.toFixed(6));
    if (v2013) for (const _ of def.pattern) { void _; w.g(74, 0); }
  }
  w.g(0, 'ENDTAB');

  // LAYER
  w.g(0, 'TABLE'); w.g(2, 'LAYER');
  if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTable'); }
  w.g(70, doc.layers.length + 1);
  writeLayer(w, v2013, { name: '0', color: '#ffffff', linetype: 'CONTINUOUS', lineweightUm: 250, visible: true, locked: false, printable: true });
  for (const l of doc.layers) writeLayer(w, v2013, l);
  w.g(0, 'ENDTAB');

  // STYLE
  w.g(0, 'TABLE'); w.g(2, 'STYLE');
  if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTable'); }
  w.g(70, 1);
  w.g(0, 'STYLE');
  if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbTextStyleTableRecord'); }
  w.g(2, 'STANDARD'); w.g(70, 0); w.g(40, '0.0'); w.g(41, '1.0'); w.g(50, '0.0');
  w.g(71, 0); w.g(42, '2.5'); w.g(3, 'txt'); w.g(4, '');
  w.g(0, 'ENDTAB');

  if (v2013) {
    // APPID / DIMSTYLE / BLOCK_RECORD（2013形式で必要）
    w.g(0, 'TABLE'); w.g(2, 'APPID'); w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTable'); w.g(70, 1);
    w.g(0, 'APPID'); w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbRegAppTableRecord');
    w.g(2, 'ACAD'); w.g(70, 0);
    w.g(0, 'ENDTAB');

    w.g(0, 'TABLE'); w.g(2, 'DIMSTYLE'); w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTable'); w.g(70, 1);
    w.g(0, 'DIMSTYLE'); w.g(105, w.nextHandle()); w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbDimStyleTableRecord');
    w.g(2, 'JIS'); w.g(70, 0); w.g(40, '1.0'); w.g(41, '3.5'); w.g(140, '3.5'); w.g(147, '1.0'); w.g(271, 2);
    w.g(0, 'ENDTAB');

    w.g(0, 'TABLE'); w.g(2, 'BLOCK_RECORD'); w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTable');
    const blockNames = ['*MODEL_SPACE', '*PAPER_SPACE', ...Object.keys(doc.blocks)];
    w.g(70, blockNames.length);
    for (const n of blockNames) {
      w.g(0, 'BLOCK_RECORD'); w.g(5, w.nextHandle());
      w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbBlockTableRecord'); w.g(2, n); w.g(70, 0);
    }
    w.g(0, 'ENDTAB');
  }
  w.g(0, 'ENDSEC');

  // ---------------- BLOCKS
  w.g(0, 'SECTION'); w.g(2, 'BLOCKS');
  // モデル空間・ペーパー空間のブロック定義（2013形式で必須）
  if (v2013) {
    for (const n of ['*Model_Space', '*Paper_Space']) {
      w.g(0, 'BLOCK'); w.g(5, w.nextHandle()); w.g(100, 'AcDbEntity'); w.g(8, '0');
      w.g(100, 'AcDbBlockBegin'); w.g(2, n); w.g(70, 0);
      w.g(10, '0.0'); w.g(20, '0.0'); w.g(30, '0.0'); w.g(3, n); w.g(1, '');
      w.g(0, 'ENDBLK'); w.g(5, w.nextHandle()); w.g(100, 'AcDbEntity'); w.g(8, '0'); w.g(100, 'AcDbBlockEnd');
    }
  }
  for (const b of Object.values(doc.blocks)) {
    w.g(0, 'BLOCK');
    if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbEntity'); }
    w.g(8, '0');
    if (v2013) w.g(100, 'AcDbBlockBegin');
    w.g(2, b.name); w.g(70, 0);
    w.coord(10, b.baseX); w.coord(20, b.baseY); w.g(30, '0.0');
    w.g(3, b.name); w.g(1, '');
    for (const e of b.entities) writeEntity(w, doc, e, v2013, explodeDims);
    w.g(0, 'ENDBLK');
    if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbEntity'); w.g(8, '0'); w.g(100, 'AcDbBlockEnd'); }
  }
  w.g(0, 'ENDSEC');

  // ---------------- ENTITIES
  w.g(0, 'SECTION'); w.g(2, 'ENTITIES');
  for (const e of doc.entities) writeEntity(w, doc, e, v2013, explodeDims);
  w.g(0, 'ENDSEC');

  if (v2013) {
    w.g(0, 'SECTION'); w.g(2, 'OBJECTS');
    w.g(0, 'DICTIONARY'); w.g(5, w.nextHandle()); w.g(100, 'AcDbDictionary'); w.g(281, 1);
    w.g(0, 'ENDSEC');
  }
  w.g(0, 'EOF');
  return w.text();
}

function writeLayer(w: Writer, v2013: boolean, l: Layer): void {
  w.g(0, 'LAYER');
  if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbSymbolTableRecord'); w.g(100, 'AcDbLayerTableRecord'); }
  w.g(2, l.name);
  w.g(70, l.locked ? 4 : 0);
  w.g(62, l.visible ? hexToAci(l.color) : -hexToAci(l.color));
  if (v2013) w.g(420, hexToTrueColor(l.color));
  w.g(6, l.linetype);
  if (v2013) { w.g(370, lwToDxf(l.lineweightUm)); w.g(390, 'F'); }
  if (!l.printable) w.g(290, 0);
}

/** DXFの線幅は 1/100mm 単位の整数 */
function lwToDxf(um: number): number { return Math.round(um / 10); }

function common(w: Writer, doc: CadDocument, e: Entity, v2013: boolean, subclass?: string): void {
  if (v2013) { w.g(5, w.nextHandle()); w.g(100, 'AcDbEntity'); }
  w.g(8, e.layer || '0');
  if (e.color) { w.g(62, hexToAci(e.color)); if (v2013) w.g(420, hexToTrueColor(e.color)); }
  else w.g(62, 256); // ByLayer
  if (e.linetype) w.g(6, e.linetype);
  if (e.lineweightUm !== null && v2013) w.g(370, lwToDxf(e.lineweightUm));
  if (v2013 && subclass) w.g(100, subclass);
  void doc;
}

function writeEntity(w: Writer, doc: CadDocument, e: Entity, v2013: boolean, explodeDims: boolean): void {
  switch (e.type) {
    case 'line':
      w.g(0, 'LINE'); common(w, doc, e, v2013, 'AcDbLine');
      w.coord(10, e.x1); w.coord(20, e.y1); w.g(30, '0.0');
      w.coord(11, e.x2); w.coord(21, e.y2); w.g(31, '0.0');
      break;
    case 'circle':
      w.g(0, 'CIRCLE'); common(w, doc, e, v2013, 'AcDbCircle');
      w.coord(10, e.cx); w.coord(20, e.cy); w.g(30, '0.0'); w.coord(40, e.r);
      break;
    case 'arc':
      w.g(0, 'ARC'); common(w, doc, e, v2013, 'AcDbCircle');
      w.coord(10, e.cx); w.coord(20, e.cy); w.g(30, '0.0'); w.coord(40, e.r);
      if (v2013) w.g(100, 'AcDbArc');
      w.ang(50, e.a1); w.ang(51, e.a2);
      break;
    case 'point':
      w.g(0, 'POINT'); common(w, doc, e, v2013, 'AcDbPoint');
      w.coord(10, e.x); w.coord(20, e.y); w.g(30, '0.0');
      break;
    case 'polyline':
      if (v2013) {
        w.g(0, 'LWPOLYLINE'); common(w, doc, e, v2013, 'AcDbPolyline');
        w.g(90, e.verts.length); w.g(70, e.closed ? 1 : 0);
        for (const v of e.verts) {
          w.coord(10, v.x); w.coord(20, v.y);
          if (v.bulge !== 0) w.g(42, (v.bulge / 1e6).toFixed(9));
        }
      } else {
        // R12 は LWPOLYLINE 非対応。POLYLINE + VERTEX で出力する。
        w.g(0, 'POLYLINE'); common(w, doc, e, v2013);
        w.g(66, 1); w.g(10, '0.0'); w.g(20, '0.0'); w.g(30, '0.0'); w.g(70, e.closed ? 1 : 0);
        for (const v of e.verts) {
          w.g(0, 'VERTEX'); w.g(8, e.layer || '0');
          w.coord(10, v.x); w.coord(20, v.y); w.g(30, '0.0');
          if (v.bulge !== 0) w.g(42, (v.bulge / 1e6).toFixed(9));
        }
        w.g(0, 'SEQEND'); w.g(8, e.layer || '0');
      }
      break;
    case 'text': {
      w.g(0, 'TEXT'); common(w, doc, e, v2013, 'AcDbText');
      w.coord(10, e.x); w.coord(20, e.y); w.g(30, '0.0');
      w.coord(40, e.h);
      w.g(1, e.text);
      w.ang(50, e.rot);
      w.g(7, 'STANDARD');
      const ha = e.halign === 'center' ? 1 : e.halign === 'right' ? 2 : 0;
      const va = e.valign === 'bottom' ? 1 : e.valign === 'middle' ? 2 : e.valign === 'top' ? 3 : 0;
      if (ha !== 0) w.g(72, ha);
      if (ha !== 0 || va !== 0) { w.coord(11, e.x); w.coord(21, e.y); w.g(31, '0.0'); }
      if (v2013) w.g(100, 'AcDbText');
      if (va !== 0) w.g(73, va);
      break;
    }
    case 'insert':
      w.g(0, 'INSERT'); common(w, doc, e, v2013, 'AcDbBlockReference');
      w.g(2, e.block);
      w.coord(10, e.x); w.coord(20, e.y); w.g(30, '0.0');
      w.g(41, (e.sx / 1e6).toFixed(9)); w.g(42, (e.sy / 1e6).toFixed(9)); w.g(43, '1.0');
      w.ang(50, e.rot);
      break;
    case 'ellipse': {
      if (!v2013) {
        // R12 は ELLIPSE 非対応 → ポリライン近似
        const poly = entityToPolygon(doc, e);
        writePolyPoints(w, doc, e, poly, false, v2013);
        break;
      }
      w.g(0, 'ELLIPSE'); common(w, doc, e, v2013, 'AcDbEllipse');
      w.coord(10, e.cx); w.coord(20, e.cy); w.g(30, '0.0');
      w.coord(11, e.majX); w.coord(21, e.majY); w.g(31, '0.0');
      w.g(210, '0.0'); w.g(220, '0.0'); w.g(230, '1.0');
      w.g(40, (e.ratio / 1e6).toFixed(9));
      w.g(41, ((e.a1 / UDEG_PER_DEG) * Math.PI / 180).toFixed(9));
      w.g(42, ((e.a2 / UDEG_PER_DEG) * Math.PI / 180).toFixed(9));
      break;
    }
    case 'hatch': {
      // ハッチングは線分に分解して出力（互換性優先）
      for (const seg of hatchLines(doc, e.boundary, e.angle, e.spacing)) {
        w.g(0, 'LINE'); common(w, doc, e, v2013, 'AcDbLine');
        w.coord(10, seg[0].x); w.coord(20, seg[0].y); w.g(30, '0.0');
        w.coord(11, seg[1].x); w.coord(21, seg[1].y); w.g(31, '0.0');
      }
      break;
    }
    case 'dim': {
      if (explodeDims) writeGeomAsDxf(w, doc, e, dimGeometry(doc, e), v2013);
      break;
    }
    case 'gtol': case 'leader': case 'surf':
      writeGeomAsDxf(w, doc, e, annotGeometry(doc, e), v2013);
      break;
  }
}

/** 寸法・注記を線・円弧・矢印(SOLID)・文字として出力する（他社CADでの互換性が最も高い） */
function writeGeomAsDxf(w: Writer, doc: CadDocument, e: Entity, g: DimGeom, v2013: boolean): void {
  for (const l of g.lines) {
    w.g(0, 'LINE'); common(w, doc, e, v2013, 'AcDbLine');
    w.coord(10, l.a.x); w.coord(20, l.a.y); w.g(30, '0.0');
    w.coord(11, l.b.x); w.coord(21, l.b.y); w.g(31, '0.0');
  }
  for (const a of g.arcs) {
    const full = ((a.a2 - a.a1) % (360 * UDEG_PER_DEG) + 360 * UDEG_PER_DEG) % (360 * UDEG_PER_DEG);
    if (full === 0) {
      w.g(0, 'CIRCLE'); common(w, doc, e, v2013, 'AcDbCircle');
      w.coord(10, a.c.x); w.coord(20, a.c.y); w.g(30, '0.0'); w.coord(40, a.r);
    } else {
      w.g(0, 'ARC'); common(w, doc, e, v2013, 'AcDbCircle');
      w.coord(10, a.c.x); w.coord(20, a.c.y); w.g(30, '0.0'); w.coord(40, a.r);
      if (v2013) w.g(100, 'AcDbArc');
      w.ang(50, a.a1); w.ang(51, a.a2);
    }
  }
  for (const a of g.arrows) {
    const back = (a.angleUDeg + 180 * UDEG_PER_DEG) % (360 * UDEG_PER_DEG);
    const t1 = polar(a.p, (back + 9 * UDEG_PER_DEG) % (360 * UDEG_PER_DEG), a.size);
    const t2 = polar(a.p, (back - 9 * UDEG_PER_DEG + 360 * UDEG_PER_DEG) % (360 * UDEG_PER_DEG), a.size);
    w.g(0, 'SOLID'); common(w, doc, e, v2013, 'AcDbTrace');
    w.coord(10, a.p.x); w.coord(20, a.p.y); w.g(30, '0.0');
    w.coord(11, t1.x); w.coord(21, t1.y); w.g(31, '0.0');
    w.coord(12, t2.x); w.coord(22, t2.y); w.g(32, '0.0');
    w.coord(13, t2.x); w.coord(23, t2.y); w.g(33, '0.0');
  }
  for (const t of g.texts) {
    w.g(0, 'TEXT'); common(w, doc, e, v2013, 'AcDbText');
    w.coord(10, t.p.x); w.coord(20, t.p.y); w.g(30, '0.0');
    w.coord(40, t.h); w.g(1, t.text); w.ang(50, t.rotUDeg); w.g(7, 'STANDARD');
    w.g(72, t.halign === 'center' ? 1 : t.halign === 'right' ? 2 : 0);
    w.coord(11, t.p.x); w.coord(21, t.p.y); w.g(31, '0.0');
    if (v2013) w.g(100, 'AcDbText');
    w.g(73, t.valign === 'bottom' ? 1 : t.valign === 'middle' ? 2 : t.valign === 'top' ? 3 : 0);
  }
}

function writePolyPoints(w: Writer, doc: CadDocument, e: Entity, pts: Pt[], closed: boolean, v2013: boolean): void {
  w.g(0, 'POLYLINE'); common(w, doc, e, v2013);
  w.g(66, 1); w.g(10, '0.0'); w.g(20, '0.0'); w.g(30, '0.0'); w.g(70, closed ? 1 : 0);
  for (const p of pts) {
    w.g(0, 'VERTEX'); w.g(8, e.layer || '0');
    w.coord(10, p.x); w.coord(20, p.y); w.g(30, '0.0');
  }
  w.g(0, 'SEQEND'); w.g(8, e.layer || '0');
}

function hatchLines(doc: CadDocument, boundary: string[], angle: number, spacing: number): [Pt, Pt][] {
  // 画面描画と同じロジックを使うため、境界ポリゴンから直接生成する
  const polys: Pt[][] = [];
  for (const id of boundary) {
    const e = doc.entities.find((x) => x.id === id);
    if (e) polys.push(entityToPolygon(doc, e));
  }
  if (!polys.length) return [];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of polys) for (const q2 of p) {
    x1 = Math.min(x1, q2.x); y1 = Math.min(y1, q2.y); x2 = Math.max(x2, q2.x); y2 = Math.max(y2, q2.y);
  }
  const out: [Pt, Pt][] = [];
  const diag = Math.hypot(x2 - x1, y2 - y1);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const sp = Math.max(200, spacing);
  const n = Math.ceil(diag / sp) + 1;
  for (let i = -n; i <= n; i++) {
    const base = polar({ x: cx, y: cy }, (angle + 90 * UDEG_PER_DEG) % (360 * UDEG_PER_DEG), i * sp);
    const a = polar(base, angle, -diag), b = polar(base, angle, diag);
    const ts: number[] = [0, 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const poly of polys) {
      for (let k = 0; k < poly.length; k++) {
        const p1 = poly[k], p2 = poly[(k + 1) % poly.length];
        const ex = p2.x - p1.x, ey = p2.y - p1.y;
        const den = dx * ey - dy * ex;
        if (den === 0) continue;
        const t = ((p1.x - a.x) * ey - (p1.y - a.y) * ex) / den;
        const u = ((p1.x - a.x) * dy - (p1.y - a.y) * dx) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) ts.push(t);
      }
    }
    ts.sort((p, q2) => p - q2);
    for (let k = 0; k + 1 < ts.length; k++) {
      const tm = (ts[k] + ts[k + 1]) / 2;
      const mid = { x: a.x + dx * tm, y: a.y + dy * tm };
      let inside = false;
      for (const poly of polys) {
        let c = false;
        for (let m = 0, j = poly.length - 1; m < poly.length; j = m++) {
          const xi = poly[m].x, yi = poly[m].y, xj = poly[j].x, yj = poly[j].y;
          if ((yi > mid.y) !== (yj > mid.y) && mid.x < ((xj - xi) * (mid.y - yi)) / (yj - yi) + xi) c = !c;
        }
        if (c) inside = !inside;
      }
      if (inside) out.push([{ x: a.x + dx * ts[k], y: a.y + dy * ts[k] }, { x: a.x + dx * ts[k + 1], y: a.y + dy * ts[k + 1] }]);
    }
  }
  return out;
}

export { sweepCCW, onCircle, entSegs, polySegs, explodeInsert };
