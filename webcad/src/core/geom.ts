/**
 * 幾何計算。入力・出力の座標はすべて整数µm。
 * 途中計算は倍精度小数で行い、返す瞬間に q() で整数化する（仕様 2-3）。
 */
import { q, qAngle, FULL_TURN, UDEG_PER_DEG, TOL, radToUDeg, uDegToRad } from './units.js';

export interface Pt { x: number; y: number }

export const pt = (x: number, y: number): Pt => ({ x: q(x), y: q(y) });
/** 丸めずにそのまま持つ（中間計算用の小数点） */
export const ptRaw = (x: number, y: number): Pt => ({ x, y });

export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
export const len = (a: Pt): number => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Pt, b: Pt): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const same = (a: Pt, b: Pt, tol = TOL.point): boolean => dist2(a, b) <= tol * tol;

/** 点a→点bの方向角（µdeg, 0..360e6） */
export function angleOf(a: Pt, b: Pt): number {
  return radToUDeg(Math.atan2(b.y - a.y, b.x - a.x));
}

/** 極座標で点を作る: 基準点から角度(µdeg)・距離(µm) */
export function polar(base: Pt, udeg: number, distance: number): Pt {
  const r = uDegToRad(udeg);
  return pt(base.x + Math.cos(r) * distance, base.y + Math.sin(r) * distance);
}

/** 角度差を -180e6..+180e6 に正規化 */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % FULL_TURN;
  if (d > FULL_TURN / 2) d -= FULL_TURN;
  if (d < -FULL_TURN / 2) d += FULL_TURN;
  return d;
}

/** 反時計回りで a1 から a2 までの掃引角（0..360e6） */
export function sweepCCW(a1: number, a2: number): number {
  let s = (a2 - a1) % FULL_TURN;
  if (s < 0) s += FULL_TURN;
  return s;
}

/** 角度 a が円弧 [a1→a2 (CCW)] の範囲内か */
export function angleInArc(a: number, a1: number, a2: number): boolean {
  const total = sweepCCW(a1, a2) || FULL_TURN;
  return sweepCCW(a1, qAngle(a)) <= total + 1;
}

// ---------------------------------------------------------------- 線分

/** 点pから直線ab（無限直線）へ下ろした垂線の足 */
export function perpFoot(p: Pt, a: Pt, b: Pt): Pt | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dd = dx * dx + dy * dy;
  if (dd === 0) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / dd;
  return pt(a.x + dx * t, a.y + dy * t);
}

/** 線分ab上で点pに最も近い点（端点でクランプ） */
export function closestOnSeg(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dd = dx * dx + dy * dy;
  if (dd === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / dd;
  t = Math.max(0, Math.min(1, t));
  return pt(a.x + dx * t, a.y + dy * t);
}

/** 点と線分の距離 */
export function distToSeg(p: Pt, a: Pt, b: Pt): number {
  return dist(p, closestOnSeg(p, a, b));
}

export interface LineXResult { p: Pt; t1: number; t2: number }

/**
 * 直線ab と 直線cd の交点（無限直線として）。
 * t1/t2 は各線分上のパラメータ（0..1 が線分内）。
 */
export function lineLineX(a: Pt, b: Pt, c: Pt, d: Pt): LineXResult | null {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (den === 0) return null; // 平行または同一直線
  const qp = sub(c, a);
  const t1 = cross(qp, s) / den;
  const t2 = cross(qp, r) / den;
  return { p: pt(a.x + r.x * t1, a.y + r.y * t1), t1, t2 };
}

/** 線分同士の交点（線分内のみ） */
export function segSegX(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const r = lineLineX(a, b, c, d);
  if (!r) return null;
  const e = 1e-9;
  if (r.t1 < -e || r.t1 > 1 + e || r.t2 < -e || r.t2 > 1 + e) return null;
  return r.p;
}

// ---------------------------------------------------------------- 円

/** 直線ab（無限直線）と円(c,r)の交点 */
export function lineCircleX(a: Pt, b: Pt, c: Pt, r: number): Pt[] {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dd = dx * dx + dy * dy;
  if (dd === 0) return [];
  const fx = a.x - c.x, fy = a.y - c.y;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = B * B - 4 * dd * C;
  if (disc < 0) return [];
  if (disc === 0) {
    const t = -B / (2 * dd);
    return [pt(a.x + dx * t, a.y + dy * t)];
  }
  const sq = Math.sqrt(disc);
  const t1 = (-B - sq) / (2 * dd);
  const t2 = (-B + sq) / (2 * dd);
  return [pt(a.x + dx * t1, a.y + dy * t1), pt(a.x + dx * t2, a.y + dy * t2)];
}

/** 円と円の交点 */
export function circleCircleX(c1: Pt, r1: number, c2: Pt, r2: number): Pt[] {
  const d = dist(c1, c2);
  if (d === 0) return [];
  if (d > r1 + r2 + 1e-9) return [];
  if (d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ux = (c2.x - c1.x) / d, uy = (c2.y - c1.y) / d;
  const px = c1.x + a * ux, py = c1.y + a * uy;
  if (h === 0) return [pt(px, py)];
  return [pt(px - h * uy, py + h * ux), pt(px + h * uy, py - h * ux)];
}

/** 点pから円(c,r)への接点（2点） */
export function tangentPoints(p: Pt, c: Pt, r: number): Pt[] {
  const d = dist(p, c);
  if (d < r - 1e-9) return [];
  if (Math.abs(d - r) <= 1e-9) return [pt(p.x, p.y)];
  const a = (r * r) / d;
  const h = Math.sqrt(Math.max(0, r * r - a * a));
  const ux = (p.x - c.x) / d, uy = (p.y - c.y) / d;
  const bx = c.x + a * ux, by = c.y + a * uy;
  return [pt(bx - h * uy, by + h * ux), pt(bx + h * uy, by - h * ux)];
}

/** 3点を通る円（中心と半径）。一直線上なら null。 */
export function circleFrom3(a: Pt, b: Pt, c: Pt): { c: Pt; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const center = pt(ux, uy);
  return { c: center, r: q(Math.hypot(a.x - ux, a.y - uy)) };
}

/** 円上の角度(µdeg)の点 */
export function onCircle(c: Pt, r: number, udeg: number): Pt {
  const rad = uDegToRad(udeg);
  return pt(c.x + r * Math.cos(rad), c.y + r * Math.sin(rad));
}

/** 3点(始点・通過点・終点)から円弧を作る */
export function arcFrom3(p1: Pt, p2: Pt, p3: Pt): { c: Pt; r: number; a1: number; a2: number } | null {
  const cir = circleFrom3(p1, p2, p3);
  if (!cir) return null;
  const a1 = angleOf(cir.c, p1);
  const am = angleOf(cir.c, p2);
  const a3 = angleOf(cir.c, p3);
  // p1→p2→p3 の順に反時計回りで通るか判定
  const ccw = sweepCCW(a1, am) < sweepCCW(a1, a3);
  return ccw ? { c: cir.c, r: cir.r, a1, a2: a3 } : { c: cir.c, r: cir.r, a1: a3, a2: a1 };
}

// ------------------------------------------------- バルジ（ポリラインの膨らみ）

/** バルジ値は tan(掃引角/4)。整数保持のため 1/1,000,000 単位で保存する。 */
export const BULGE_SCALE = 1_000_000;

export function bulgeToArc(p1: Pt, p2: Pt, bulgeMicro: number):
  { c: Pt; r: number; a1: number; a2: number; ccw: boolean } | null {
  const b = bulgeMicro / BULGE_SCALE;
  if (b === 0) return null;
  const chord = dist(p1, p2);
  if (chord === 0) return null;
  const theta = 4 * Math.atan(b);           // 掃引角(rad, 符号付き)
  const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const h = (chord / 2) / Math.tan(theta / 2);
  const ux = (p2.x - p1.x) / chord, uy = (p2.y - p1.y) / chord;
  // 中心 = 弦の中点 + 弦に垂直な単位ベクトル(-uy, ux) × h
  const c = pt(mid.x - uy * h, mid.y + ux * h);
  const a1 = angleOf(c, p1), a2 = angleOf(c, p2);
  return { c, r: q(r), a1, a2, ccw: b > 0 };
}

/** 円弧(始点・終点・掃引角)からバルジ値(1e-6単位の整数)を得る */
export function arcToBulge(sweepUDeg: number): number {
  const theta = uDegToRad(sweepUDeg);
  return Math.round(Math.tan(theta / 4) * BULGE_SCALE);
}

// ---------------------------------------------------------------- 変換

export interface Xform { a: number; b: number; c: number; d: number; e: number; f: number }
/** [a c e; b d f] のアフィン変換。平行移動 e,f は µm。 */
export const IDENT: Xform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function xfTranslate(dx: number, dy: number): Xform {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}
export function xfRotate(udeg: number, about: Pt = { x: 0, y: 0 }): Xform {
  const r = uDegToRad(udeg), cs = Math.cos(r), sn = Math.sin(r);
  return {
    a: cs, b: sn, c: -sn, d: cs,
    e: about.x - cs * about.x + sn * about.y,
    f: about.y - sn * about.x - cs * about.y,
  };
}
export function xfScale(sx: number, sy: number, about: Pt = { x: 0, y: 0 }): Xform {
  return { a: sx, b: 0, c: 0, d: sy, e: about.x - sx * about.x, f: about.y - sy * about.y };
}
/** 直線(a,b)を軸とした鏡像 */
export function xfMirror(a: Pt, b: Pt): Xform {
  const dx = b.x - a.x, dy = b.y - a.y;
  const dd = dx * dx + dy * dy;
  if (dd === 0) return { ...IDENT };
  const ux = dx / Math.sqrt(dd), uy = dy / Math.sqrt(dd);
  const A = ux * ux - uy * uy, B = 2 * ux * uy;
  return {
    a: A, b: B, c: B, d: -A,
    e: a.x - A * a.x - B * a.y,
    f: a.y - B * a.x + A * a.y,
  };
}
export function xfMul(m: Xform, n: Xform): Xform {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}
/** 変換を適用して整数µmへ丸める（仕様 2-3） */
export function xfPt(m: Xform, p: Pt): Pt {
  return pt(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f);
}
/** 変換の回転成分（µdeg） */
export function xfAngle(m: Xform): number {
  return radToUDeg(Math.atan2(m.b, m.a));
}
/** 変換のスケール成分（等方でない場合は X 方向） */
export function xfScaleX(m: Xform): number { return Math.hypot(m.a, m.b); }
export function xfScaleY(m: Xform): number { return Math.hypot(m.c, m.d); }
/** 鏡像を含むか（行列式が負） */
export function xfFlips(m: Xform): boolean { return m.a * m.d - m.b * m.c < 0; }

// ---------------------------------------------------------------- 境界枠

export interface BBox { x1: number; y1: number; x2: number; y2: number }
export const EMPTY_BBOX: BBox = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
export function bboxAdd(b: BBox, p: Pt): BBox {
  return { x1: Math.min(b.x1, p.x), y1: Math.min(b.y1, p.y), x2: Math.max(b.x2, p.x), y2: Math.max(b.y2, p.y) };
}
export function bboxUnion(a: BBox, b: BBox): BBox {
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
}
export function bboxValid(b: BBox): boolean { return b.x1 <= b.x2 && b.y1 <= b.y2; }
export function bboxOverlap(a: BBox, b: BBox): boolean {
  return a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
}
export function bboxContains(outer: BBox, inner: BBox): boolean {
  return outer.x1 <= inner.x1 && outer.y1 <= inner.y1 && outer.x2 >= inner.x2 && outer.y2 >= inner.y2;
}
export function bboxOfArc(c: Pt, r: number, a1: number, a2: number): BBox {
  let b: BBox = EMPTY_BBOX;
  b = bboxAdd(b, onCircle(c, r, a1));
  b = bboxAdd(b, onCircle(c, r, a2));
  for (let k = 0; k < 4; k++) {
    const a = k * 90 * UDEG_PER_DEG;
    if (angleInArc(a, a1, a2)) b = bboxAdd(b, onCircle(c, r, a));
  }
  return b;
}
