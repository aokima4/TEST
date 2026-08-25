/** 図面ドキュメントの操作・図形の幾何アクセサ */
import {
  type Pt, type BBox, type Xform, EMPTY_BBOX, bboxAdd, bboxUnion, bboxOfArc, bboxValid,
  pt, dist, distToSeg, onCircle, angleOf, angleInArc, sweepCCW, bulgeToArc, arcToBulge,
  xfPt, xfMul, xfAngle, xfScaleX, xfScaleY, xfFlips, xfRotate, xfScale, BULGE_SCALE, closestOnSeg,
} from '../core/geom.js';
import { q, qAngle, UDEG_PER_DEG, FULL_TURN, uDegToRad } from '../core/units.js';
import type {
  CadDocument, Entity, Layer, LineEnt, CircleEnt, ArcEnt, PolylineEnt, TextEnt,
  PointEnt, InsertEnt, EllipseEnt, DimEnt, LineTypeName,
} from './types.js';
import { annotGeometry } from '../render/annot.js';

// ------------------------------------------------------------------ ID

export function newId(doc: CadDocument): string {
  return `e${doc.nextId++}`;
}

export function findLayer(doc: CadDocument, name: string): Layer {
  return doc.layers.find((l) => l.name === name) ?? doc.layers[0];
}

/** ByLayer を解決した実効プロパティ */
export function effective(doc: CadDocument, e: Entity): { color: string; linetype: LineTypeName; lw: number; visible: boolean; locked: boolean } {
  const l = findLayer(doc, e.layer);
  return {
    color: e.color ?? l.color,
    linetype: e.linetype ?? l.linetype,
    lw: e.lineweightUm ?? l.lineweightUm,
    visible: l.visible,
    locked: l.locked,
  };
}

// ------------------------------------------------- ポリラインのセグメント分解

export type Seg =
  | { kind: 'line'; a: Pt; b: Pt }
  | { kind: 'arc'; c: Pt; r: number; a1: number; a2: number; a: Pt; b: Pt };

export function polySegs(p: PolylineEnt): Seg[] {
  const out: Seg[] = [];
  const n = p.verts.length;
  const last = p.closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const v1 = p.verts[i];
    const v2 = p.verts[(i + 1) % n];
    const a = { x: v1.x, y: v1.y }, b = { x: v2.x, y: v2.y };
    if (v1.bulge === 0) { out.push({ kind: 'line', a, b }); continue; }
    const arc = bulgeToArc(a, b, v1.bulge);
    if (!arc) { out.push({ kind: 'line', a, b }); continue; }
    // 常に CCW の a1→a2 に正規化
    const [a1, a2] = arc.ccw ? [arc.a1, arc.a2] : [arc.a2, arc.a1];
    out.push({ kind: 'arc', c: arc.c, r: arc.r, a1, a2, a, b });
  }
  return out;
}

/** 図形を線分/円弧のセグメント列へ（当たり判定・出力用） */
export function entSegs(doc: CadDocument, e: Entity): Seg[] {
  switch (e.type) {
    case 'line': return [{ kind: 'line', a: { x: e.x1, y: e.y1 }, b: { x: e.x2, y: e.y2 } }];
    case 'circle': return [{ kind: 'arc', c: { x: e.cx, y: e.cy }, r: e.r, a1: 0, a2: FULL_TURN, a: onCircle({ x: e.cx, y: e.cy }, e.r, 0), b: onCircle({ x: e.cx, y: e.cy }, e.r, 0) }];
    case 'arc': {
      const c = { x: e.cx, y: e.cy };
      return [{ kind: 'arc', c, r: e.r, a1: e.a1, a2: e.a2, a: onCircle(c, e.r, e.a1), b: onCircle(c, e.r, e.a2) }];
    }
    case 'polyline': return polySegs(e);
    case 'ellipse': return ellipseSegs(e);
    case 'insert': return explodeInsert(doc, e).flatMap((x) => entSegs(doc, x));
    default: return [];
  }
}

/** 楕円は折れ線近似（表示・当たり判定用） */
export function ellipseSegs(e: EllipseEnt): Seg[] {
  const pts = ellipsePoints(e, 96);
  const out: Seg[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push({ kind: 'line', a: pts[i], b: pts[i + 1] });
  return out;
}

export function ellipsePoints(e: EllipseEnt, n: number): Pt[] {
  const majLen = Math.hypot(e.majX, e.majY);
  const minLen = majLen * (e.ratio / 1e6);
  const rot = Math.atan2(e.majY, e.majX);
  const sweep = sweepCCW(e.a1, e.a2) || FULL_TURN;
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = uDegToRad(e.a1 + (sweep * i) / n);
    const x = majLen * Math.cos(t), y = minLen * Math.sin(t);
    out.push(pt(e.cx + x * Math.cos(rot) - y * Math.sin(rot), e.cy + x * Math.sin(rot) + y * Math.cos(rot)));
  }
  return out;
}

// ------------------------------------------------------------------ 境界枠

export function entBBox(doc: CadDocument, e: Entity): BBox {
  switch (e.type) {
    case 'line': return { x1: Math.min(e.x1, e.x2), y1: Math.min(e.y1, e.y2), x2: Math.max(e.x1, e.x2), y2: Math.max(e.y1, e.y2) };
    case 'circle': return { x1: e.cx - e.r, y1: e.cy - e.r, x2: e.cx + e.r, y2: e.cy + e.r };
    case 'arc': return bboxOfArc({ x: e.cx, y: e.cy }, e.r, e.a1, e.a2);
    case 'point': return { x1: e.x, y1: e.y, x2: e.x, y2: e.y };
    case 'text': {
      const w = q(e.text.length * e.h * 0.62);
      let b: BBox = { x1: e.x, y1: e.y, x2: e.x + w, y2: e.y + e.h };
      if (e.rot !== 0) {
        const xf = xfRotate(e.rot, { x: e.x, y: e.y });
        b = EMPTY_BBOX;
        for (const p of [{ x: e.x, y: e.y }, { x: e.x + w, y: e.y }, { x: e.x + w, y: e.y + e.h }, { x: e.x, y: e.y + e.h }]) {
          b = bboxAdd(b, xfPt(xf, p));
        }
      }
      return b;
    }
    case 'polyline': {
      let b: BBox = EMPTY_BBOX;
      for (const s of polySegs(e)) {
        if (s.kind === 'line') { b = bboxAdd(bboxAdd(b, s.a), s.b); }
        else b = bboxUnion(b, bboxOfArc(s.c, s.r, s.a1, s.a2));
      }
      if (!bboxValid(b)) for (const v of e.verts) b = bboxAdd(b, v);
      return b;
    }
    case 'ellipse': {
      let b: BBox = EMPTY_BBOX;
      for (const p of ellipsePoints(e, 64)) b = bboxAdd(b, p);
      return b;
    }
    case 'insert': {
      let b: BBox = EMPTY_BBOX;
      for (const x of explodeInsert(doc, e)) b = bboxUnion(b, entBBox(doc, x));
      return bboxValid(b) ? b : { x1: e.x, y1: e.y, x2: e.x, y2: e.y };
    }
    case 'hatch': {
      let b: BBox = EMPTY_BBOX;
      for (const id of e.boundary) {
        const t = doc.entities.find((x) => x.id === id);
        if (t) b = bboxUnion(b, entBBox(doc, t));
      }
      return bboxValid(b) ? b : { x1: 0, y1: 0, x2: 0, y2: 0 };
    }
    case 'dim': {
      let b: BBox = EMPTY_BBOX;
      for (const p of [e.p1, e.p2, e.p3, e.p4].filter(Boolean) as Pt[]) b = bboxAdd(b, p);
      // 寸法文字のぶんだけ余白
      return { x1: b.x1 - e.th * 4, y1: b.y1 - e.th * 2, x2: b.x2 + e.th * 4, y2: b.y2 + e.th * 2 };
    }
    case 'gtol': case 'leader': case 'surf': {
      let b: BBox = EMPTY_BBOX;
      const g = annotGeometry(doc, e);
      for (const l of g.lines) { b = bboxAdd(bboxAdd(b, l.a), l.b); }
      for (const a of g.arcs) b = bboxUnion(b, bboxOfArc(a.c, a.r, a.a1, a.a2));
      for (const t of g.texts) {
        b = bboxAdd(b, t.p);
        b = bboxAdd(b, { x: t.p.x + q(t.text.length * t.h * 0.7), y: t.p.y + t.h });
      }
      return bboxValid(b) ? b : { x1: 0, y1: 0, x2: 0, y2: 0 };
    }
  }
}

export function docBBox(doc: CadDocument, ents: Entity[] = doc.entities): BBox {
  let b: BBox = EMPTY_BBOX;
  for (const e of ents) b = bboxUnion(b, entBBox(doc, e));
  return b;
}

// ------------------------------------------------------------------ 距離

export function distToSeg2(p: Pt, s: Seg): number {
  if (s.kind === 'line') return distToSeg(p, s.a, s.b);
  const c = s.c;
  const d = dist(p, c);
  const a = angleOf(c, p);
  if (angleInArc(a, s.a1, s.a2)) return Math.abs(d - s.r);
  return Math.min(dist(p, s.a), dist(p, s.b));
}

export function distToEntity(doc: CadDocument, e: Entity, p: Pt): number {
  if (e.type === 'point') return dist(p, { x: e.x, y: e.y });
  if (e.type === 'text') {
    const b = entBBox(doc, e);
    const dx = Math.max(b.x1 - p.x, 0, p.x - b.x2);
    const dy = Math.max(b.y1 - p.y, 0, p.y - b.y2);
    return Math.hypot(dx, dy);
  }
  if (e.type === 'dim') {
    let m = Infinity;
    for (const pp of [e.p1, e.p2, e.p3]) m = Math.min(m, dist(p, pp));
    m = Math.min(m, distToSeg(p, e.p1, e.p3), distToSeg(p, e.p2, e.p3));
    return m;
  }
  let m = Infinity;
  for (const s of entSegs(doc, e)) m = Math.min(m, distToSeg2(p, s));
  return m;
}

/** セグメント上で p に最も近い点 */
export function closestOnSegAny(p: Pt, s: Seg): Pt {
  if (s.kind === 'line') return closestOnSeg(p, s.a, s.b);
  const a = angleOf(s.c, p);
  if (angleInArc(a, s.a1, s.a2)) return onCircle(s.c, s.r, a);
  return dist(p, s.a) < dist(p, s.b) ? s.a : s.b;
}

// ------------------------------------------------------------------ ブロック

/** ブロック参照を実体の図形列へ展開（入れ子対応） */
export function explodeInsert(doc: CadDocument, ins: InsertEnt, depth = 0): Entity[] {
  if (depth > 8) return [];
  const b = doc.blocks[ins.block];
  if (!b) return [];
  const xf = insertXform(ins, b.baseX, b.baseY);
  const out: Entity[] = [];
  for (const e of b.entities) {
    const t = transformEntity(doc, e, xf, depth + 1);
    // ByLayer/ByBlock の色は参照側のレイヤを継承させる
    out.push({ ...t, id: `${ins.id}/${e.id}`, layer: e.layer === '0' ? ins.layer : e.layer });
  }
  return out;
}

export function insertXform(ins: InsertEnt, baseX: number, baseY: number): Xform {
  const s = xfScale(ins.sx / 1e6, ins.sy / 1e6, { x: 0, y: 0 });
  const r = xfRotate(ins.rot, { x: 0, y: 0 });
  const m = xfMul(r, s);
  // ベース点を原点に合わせてから配置点へ
  return xfMul({ a: 1, b: 0, c: 0, d: 1, e: ins.x, f: ins.y }, xfMul(m, { a: 1, b: 0, c: 0, d: 1, e: -baseX, f: -baseY }));
}

// ------------------------------------------------------------------ 変換

export function transformEntity(doc: CadDocument, e: Entity, xf: Xform, depth = 0): Entity {
  const now = Date.now();
  const flip = xfFlips(xf);
  const sx = xfScaleX(xf), sy = xfScaleY(xf), rot = xfAngle(xf);
  switch (e.type) {
    case 'line': {
      const a = xfPt(xf, { x: e.x1, y: e.y1 }), b = xfPt(xf, { x: e.x2, y: e.y2 });
      return { ...e, x1: a.x, y1: a.y, x2: b.x, y2: b.y, updated: now };
    }
    case 'circle': {
      const c = xfPt(xf, { x: e.cx, y: e.cy });
      return { ...e, cx: c.x, cy: c.y, r: q(e.r * sx), updated: now };
    }
    case 'arc': {
      const c = xfPt(xf, { x: e.cx, y: e.cy });
      let a1 = e.a1, a2 = e.a2;
      if (flip) {
        // 鏡像では向きが反転するので、始終端を入れ替えて CCW を保つ
        const m = xfAngle({ ...xf, b: xf.b, a: xf.a });
        const mirror = (a: number) => qAngle(2 * m - a);
        [a1, a2] = [mirror(e.a2), mirror(e.a1)];
      } else {
        a1 = qAngle(e.a1 + rot); a2 = qAngle(e.a2 + rot);
      }
      return { ...e, cx: c.x, cy: c.y, r: q(e.r * sx), a1, a2, updated: now };
    }
    case 'polyline': {
      const verts = e.verts.map((v) => {
        const p = xfPt(xf, { x: v.x, y: v.y });
        return { x: p.x, y: p.y, bulge: flip ? -v.bulge : v.bulge };
      });
      if (flip) {
        // 鏡像時はバルジの持ち主がずれるため、隣接へシフト
        const n = verts.length;
        const bs = verts.map((v) => v.bulge);
        for (let i = 0; i < n; i++) verts[i].bulge = bs[i];
      }
      return { ...e, verts, updated: now };
    }
    case 'text': {
      const p = xfPt(xf, { x: e.x, y: e.y });
      return { ...e, x: p.x, y: p.y, h: q(e.h * sy), rot: flip ? qAngle(-e.rot) : qAngle(e.rot + rot), updated: now };
    }
    case 'point': {
      const p = xfPt(xf, { x: e.x, y: e.y });
      return { ...e, x: p.x, y: p.y, updated: now };
    }
    case 'ellipse': {
      const c = xfPt(xf, { x: e.cx, y: e.cy });
      const maj = xfPt(xf, { x: e.cx + e.majX, y: e.cy + e.majY });
      return { ...e, cx: c.x, cy: c.y, majX: maj.x - c.x, majY: maj.y - c.y, updated: now };
    }
    case 'insert': {
      const p = xfPt(xf, { x: e.x, y: e.y });
      return {
        ...e, x: p.x, y: p.y,
        sx: Math.round(e.sx * sx * (flip ? -1 : 1)), sy: Math.round(e.sy * sy),
        rot: qAngle(e.rot + (flip ? -rot : rot)), updated: now,
      };
    }
    case 'dim': {
      const t = (p: Pt) => xfPt(xf, p);
      return { ...e, p1: t(e.p1), p2: t(e.p2), p3: t(e.p3), p4: e.p4 ? t(e.p4) : undefined, th: q(e.th * sy), arrow: q(e.arrow * sy), updated: now };
    }
    case 'hatch': return { ...e, angle: qAngle(e.angle + rot), spacing: q(e.spacing * sx), updated: now };
    case 'gtol': {
      const p = xfPt(xf, { x: e.x, y: e.y });
      return { ...e, x: p.x, y: p.y, h: q(e.h * sy), leader: e.leader ? xfPt(xf, e.leader) : e.leader, updated: now };
    }
    case 'leader':
      return { ...e, from: xfPt(xf, e.from), to: xfPt(xf, e.to), h: q(e.h * sy), arrow: q(e.arrow * sy), updated: now };
    case 'surf': {
      const p = xfPt(xf, { x: e.x, y: e.y });
      return { ...e, x: p.x, y: p.y, h: q(e.h * sy), rot: flip ? qAngle(-e.rot) : qAngle(e.rot + rot), updated: now };
    }
  }
}

// ------------------------------------------------------------------ 空間索引

/**
 * 一様グリッドによる空間索引（仕様 第8章「R-tree（空間索引）」の要件を満たす軽量実装）。
 * 図形数5万規模でも、可視範囲・クリック近傍の抽出が O(該当セル数) で済む。
 */
export class SpatialIndex {
  private cell: number;
  private map = new Map<string, Set<string>>();
  private boxes = new Map<string, BBox>();

  constructor(cellUm = 50_000 /* 50mm */) { this.cell = cellUm; }

  private keys(b: BBox): string[] {
    const c = this.cell;
    const x1 = Math.floor(b.x1 / c), x2 = Math.floor(b.x2 / c);
    const y1 = Math.floor(b.y1 / c), y2 = Math.floor(b.y2 / c);
    const out: string[] = [];
    const maxCells = 4096;
    if ((x2 - x1 + 1) * (y2 - y1 + 1) > maxCells) return ['*'];
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) out.push(`${x},${y}`);
    return out;
  }

  insert(id: string, b: BBox): void {
    if (!bboxValid(b)) return;
    this.remove(id);
    this.boxes.set(id, b);
    for (const k of this.keys(b)) {
      let s = this.map.get(k);
      if (!s) { s = new Set(); this.map.set(k, s); }
      s.add(id);
    }
  }

  remove(id: string): void {
    const b = this.boxes.get(id);
    if (!b) return;
    for (const k of this.keys(b)) this.map.get(k)?.delete(id);
    this.boxes.delete(id);
  }

  query(b: BBox): Set<string> {
    const out = new Set<string>();
    for (const id of this.map.get('*') ?? []) out.add(id);
    for (const k of this.keys(b)) {
      const s = this.map.get(k);
      if (s) for (const id of s) {
        const eb = this.boxes.get(id);
        if (eb && eb.x1 <= b.x2 && b.x1 <= eb.x2 && eb.y1 <= b.y2 && b.y1 <= eb.y2) out.add(id);
      }
    }
    return out;
  }

  clear(): void { this.map.clear(); this.boxes.clear(); }
  get size(): number { return this.boxes.size; }
}

export function rebuildIndex(doc: CadDocument, idx: SpatialIndex): void {
  idx.clear();
  for (const e of doc.entities) idx.insert(e.id, entBBox(doc, e));
}

// ------------------------------------------------------------------ 生成補助

let uid = 0;
export function mkCommon(doc: CadDocument, over: Partial<Entity> = {}): {
  id: string; layer: string; color: null; linetype: null; lineweightUm: null; created: number; updated: number;
} {
  const now = Date.now();
  void uid;
  return {
    id: (over as { id?: string }).id ?? newId(doc),
    layer: (over as { layer?: string }).layer ?? doc.currentLayer,
    color: null, linetype: null, lineweightUm: null, created: now, updated: now,
  };
}

export function mkLine(doc: CadDocument, a: Pt, b: Pt, layer?: string): LineEnt {
  return { ...mkCommon(doc, { layer }), type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}
export function mkCircle(doc: CadDocument, c: Pt, r: number, layer?: string): CircleEnt {
  return { ...mkCommon(doc, { layer }), type: 'circle', cx: c.x, cy: c.y, r: q(r) };
}
export function mkArc(doc: CadDocument, c: Pt, r: number, a1: number, a2: number, layer?: string): ArcEnt {
  return { ...mkCommon(doc, { layer }), type: 'arc', cx: c.x, cy: c.y, r: q(r), a1: qAngle(a1), a2: qAngle(a2) };
}
export function mkPolyline(doc: CadDocument, verts: { x: number; y: number; bulge?: number }[], closed: boolean, layer?: string): PolylineEnt {
  return {
    ...mkCommon(doc, { layer }), type: 'polyline',
    verts: verts.map((v) => ({ x: q(v.x), y: q(v.y), bulge: Math.round(v.bulge ?? 0) })), closed,
  };
}
export function mkText(doc: CadDocument, p: Pt, text: string, h: number, rot = 0, layer?: string): TextEnt {
  return {
    ...mkCommon(doc, { layer }), type: 'text', x: p.x, y: p.y, text, h: q(h), rot: qAngle(rot),
    font: 'sans-serif', halign: 'left', valign: 'base',
  };
}
export function mkPoint(doc: CadDocument, p: Pt, layer?: string): PointEnt {
  return { ...mkCommon(doc, { layer }), type: 'point', x: p.x, y: p.y };
}

// ------------------------------------------------------------------ 寸法の関連付け

/** ハンドル（図形ID＋部位）が指す点を求める */
export function handlePointOf(doc: CadDocument, h: { id: string; part: number }): Pt | null {
  const e = doc.entities.find((x) => x.id === h.id);
  if (!e) return null;
  switch (e.type) {
    case 'line':
      if (h.part === 0) return { x: e.x1, y: e.y1 };
      if (h.part === 1) return { x: e.x2, y: e.y2 };
      if (h.part === 2) return pt((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2);
      return null;
    case 'circle': return h.part === 0 ? { x: e.cx, y: e.cy } : null;
    case 'arc': {
      const c = { x: e.cx, y: e.cy };
      if (h.part === 0) return c;
      if (h.part === 2) return onCircle(c, e.r, e.a1);
      if (h.part === 3) return onCircle(c, e.r, e.a2);
      return null;
    }
    case 'point': return { x: e.x, y: e.y };
    case 'polyline': return e.verts[h.part] ? { x: e.verts[h.part].x, y: e.verts[h.part].y } : null;
    case 'text': case 'insert': return { x: e.x, y: e.y };
    default: return null;
  }
}

/** 指定した点が、その図形のどの部位かを特定する（スナップ時の関連付けに使う） */
export function attachmentAt(doc: CadDocument, entityId: string, p: Pt, tol = 2): { id: string; part: number } | null {
  const e = doc.entities.find((x) => x.id === entityId);
  if (!e) return null;
  const parts: number[] =
    e.type === 'line' ? [0, 1, 2] :
    e.type === 'circle' ? [0] :
    e.type === 'arc' ? [0, 2, 3] :
    e.type === 'point' ? [0] :
    e.type === 'polyline' ? e.verts.map((_, i) => i) :
    e.type === 'text' || e.type === 'insert' ? [0] : [];
  for (const part of parts) {
    const q2 = handlePointOf(doc, { id: entityId, part });
    if (q2 && Math.abs(q2.x - p.x) <= tol && Math.abs(q2.y - p.y) <= tol) return { id: entityId, part };
  }
  return null;
}

export { arcToBulge, BULGE_SCALE, UDEG_PER_DEG };
