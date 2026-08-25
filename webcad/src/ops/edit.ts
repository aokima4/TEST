/** 編集コマンド（仕様 5-4）。すべて整数µmを保ったまま処理する。 */
import type { CadDocument, Entity, PolylineEnt, ArcEnt, LineEnt, CircleEnt } from '../model/types.js';
import {
  type Pt, type Xform, dist, angleOf, onCircle, polar, sweepCCW, angleInArc, lineLineX,
  perpFoot, arcToBulge, xfTranslate, xfRotate, xfScale, xfMirror, pt, closestOnSeg, lineCircleX, circleCircleX,
} from '../core/geom.js';
import { q, qAngle, UDEG_PER_DEG, FULL_TURN, TOL } from '../core/units.js';
import {
  type Seg, entSegs, transformEntity, mkLine, mkArc, mkPolyline, polySegs, explodeInsert, mkCommon,
} from '../model/doc.js';
import { dimGeometry } from '../render/dim.js';

// -------------------------------------------------------- 基本変換コマンド

export const moveXf = (dx: number, dy: number): Xform => xfTranslate(dx, dy);
export const rotateXf = (about: Pt, udeg: number): Xform => xfRotate(udeg, about);
export const scaleXf = (about: Pt, f: number): Xform => xfScale(f, f, about);
export const mirrorXf = (a: Pt, b: Pt): Xform => xfMirror(a, b);

// -------------------------------------------------------- セグメント操作

export function segPointAt(s: Seg, t: number): Pt {
  if (s.kind === 'line') return pt(s.a.x + (s.b.x - s.a.x) * t, s.a.y + (s.b.y - s.a.y) * t);
  const sweep = sweepCCW(s.a1, s.a2) || FULL_TURN;
  return onCircle(s.c, s.r, s.a1 + sweep * t);
}

export function segParamOf(s: Seg, p: Pt): number {
  if (s.kind === 'line') {
    const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
    const dd = dx * dx + dy * dy;
    if (dd === 0) return 0;
    return ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / dd;
  }
  const sweep = sweepCCW(s.a1, s.a2) || FULL_TURN;
  const a = angleOf(s.c, p);
  return sweepCCW(s.a1, a) / sweep;
}

export function segSub(s: Seg, t0: number, t1: number): Seg {
  if (s.kind === 'line') {
    return { kind: 'line', a: segPointAt(s, t0), b: segPointAt(s, t1) };
  }
  const sweep = sweepCCW(s.a1, s.a2) || FULL_TURN;
  const a1 = qAngle(s.a1 + sweep * t0), a2 = qAngle(s.a1 + sweep * t1);
  return { kind: 'arc', c: s.c, r: s.r, a1, a2, a: onCircle(s.c, s.r, a1), b: onCircle(s.c, s.r, a2) };
}

export function segLength(s: Seg): number {
  if (s.kind === 'line') return dist(s.a, s.b);
  const sweep = sweepCCW(s.a1, s.a2) || FULL_TURN;
  return (s.r * sweep * Math.PI) / (180 * UDEG_PER_DEG);
}

/** セグメント列を図形へ戻す */
export function segsToEntities(doc: CadDocument, segs: Seg[], proto: Entity): Entity[] {
  if (!segs.length) return [];
  const common = { layer: proto.layer, color: proto.color, linetype: proto.linetype, lineweightUm: proto.lineweightUm };
  if (segs.length === 1) {
    const s = segs[0];
    if (s.kind === 'line') {
      if (dist(s.a, s.b) < TOL.point) return [];
      return [{ ...mkLine(doc, s.a, s.b), ...common }];
    }
    const sweep = sweepCCW(s.a1, s.a2);
    if (sweep < 100) return [];
    return [{ ...mkArc(doc, s.c, s.r, s.a1, s.a2), ...common }];
  }
  const verts: { x: number; y: number; bulge: number }[] = [];
  for (const s of segs) {
    const bulge = s.kind === 'arc' ? arcToBulge(sweepCCW(s.a1, s.a2)) : 0;
    const a = s.kind === 'line' ? s.a : onCircle(s.c, s.r, s.a1);
    verts.push({ x: a.x, y: a.y, bulge });
  }
  const last = segs[segs.length - 1];
  const endP = last.kind === 'line' ? last.b : onCircle(last.c, last.r, last.a2);
  verts.push({ x: endP.x, y: endP.y, bulge: 0 });
  return [{ ...mkPolyline(doc, verts, false), ...common }];
}

// -------------------------------------------------------- トリム／延長

/** 対象図形と切断図形群の交点（対象上のパラメータ u = セグ番号 + 局所t） */
function cutParams(doc: CadDocument, target: Entity, cutters: Entity[]): { u: number; p: Pt }[] {
  const tsegs = entSegs(doc, target);
  const out: { u: number; p: Pt }[] = [];
  for (const c of cutters) {
    if (c.id === target.id) continue;
    for (const cs of entSegs(doc, c)) {
      for (let i = 0; i < tsegs.length; i++) {
        for (const p of intersectSegs(tsegs[i], cs)) {
          const t = segParamOf(tsegs[i], p);
          if (t >= -1e-9 && t <= 1 + 1e-9) out.push({ u: i + Math.min(1, Math.max(0, t)), p });
        }
      }
    }
  }
  out.sort((a, b) => a.u - b.u);
  // 重複除去
  return out.filter((v, i) => i === 0 || Math.abs(v.u - out[i - 1].u) > 1e-9);
}

export function intersectSegs(a: Seg, b: Seg): Pt[] {
  const inA = (p: Pt) => onSeg(p, a), inB = (p: Pt) => onSeg(p, b);
  let pts: Pt[] = [];
  if (a.kind === 'line' && b.kind === 'line') {
    const x = lineLineX(a.a, a.b, b.a, b.b);
    pts = x ? [x.p] : [];
  } else if (a.kind === 'line' && b.kind === 'arc') {
    pts = lineCircleX(a.a, a.b, b.c, b.r);
  } else if (a.kind === 'arc' && b.kind === 'line') {
    pts = lineCircleX(b.a, b.b, a.c, a.r);
  } else if (a.kind === 'arc' && b.kind === 'arc') {
    pts = circleCircleX(a.c, a.r, b.c, b.r);
  }
  return pts.filter((p) => inA(p) && inB(p));
}

function onSeg(p: Pt, s: Seg): boolean {
  if (s.kind === 'line') {
    const t = segParamOf(s, p);
    return t >= -1e-6 && t <= 1 + 1e-6 && dist(closestOnSeg(p, s.a, s.b), p) < 10;
  }
  const sweep = sweepCCW(s.a1, s.a2);
  if (sweep === 0) return true;
  return angleInArc(angleOf(s.c, p), s.a1, s.a2);
}

/**
 * トリム：pick 位置を含む区間を切り取る。
 * 戻り値は差し替え後の図形（空配列なら削除）。null なら対象外。
 */
export function trim(doc: CadDocument, target: Entity, cutters: Entity[], pick: Pt): Entity[] | null {
  if (target.type === 'circle') return trimCircle(doc, target, cutters, pick);
  const segs = entSegs(doc, target);
  if (!segs.length) return null;
  const cuts = cutParams(doc, target, cutters);
  if (!cuts.length) return null;

  const uPick = pickParam(segs, pick);
  const closed = target.type === 'polyline' && target.closed;
  const uMax = segs.length;

  let lo = 0, hi = uMax;
  for (const c of cuts) { if (c.u <= uPick) lo = Math.max(lo, c.u); }
  for (const c of cuts) { if (c.u >= uPick) hi = Math.min(hi, c.u); }
  if (closed && (lo === 0 || hi === uMax)) {
    // 閉図形は端がないので、切り口をまたいで残りを1本にする
    const first = cuts[0], last = cuts[cuts.length - 1];
    if (uPick < first.u || uPick > last.u) {
      const keep = subRange(segs, first.u, last.u);
      return segsToEntities(doc, keep, target);
    }
  }
  const pieces: Seg[][] = [];
  if (lo > 1e-9) pieces.push(subRange(segs, 0, lo));
  if (hi < uMax - 1e-9) pieces.push(subRange(segs, hi, uMax));
  const out: Entity[] = [];
  for (const p2 of pieces) out.push(...segsToEntities(doc, p2, target));
  return out;
}

function trimCircle(doc: CadDocument, c: CircleEnt, cutters: Entity[], pick: Pt): Entity[] | null {
  const center = { x: c.cx, y: c.cy };
  const angs: number[] = [];
  const cseg: Seg = { kind: 'arc', c: center, r: c.r, a1: 0, a2: FULL_TURN, a: onCircle(center, c.r, 0), b: onCircle(center, c.r, 0) };
  for (const cut of cutters) {
    if (cut.id === c.id) continue;
    for (const s of entSegs(doc, cut)) for (const p of intersectSegs(cseg, s)) angs.push(angleOf(center, p));
  }
  if (angs.length < 2) return null;
  angs.sort((a, b) => a - b);
  const pa = angleOf(center, pick);
  let before = angs[angs.length - 1], after = angs[0];
  for (const a of angs) { if (a <= pa) before = a; }
  for (let i = angs.length - 1; i >= 0; i--) { if (angs[i] >= pa) after = angs[i]; }
  const arc = mkArc(doc, center, c.r, after, before);
  return [{ ...arc, layer: c.layer, color: c.color, linetype: c.linetype, lineweightUm: c.lineweightUm }];
}

function pickParam(segs: Seg[], pick: Pt): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const t = Math.min(1, Math.max(0, segParamOf(segs[i], pick)));
    const d = dist(segPointAt(segs[i], t), pick);
    if (d < bestD) { bestD = d; best = i + t; }
  }
  return best;
}

function subRange(segs: Seg[], u0: number, u1: number): Seg[] {
  const out: Seg[] = [];
  const i0 = Math.floor(u0), i1 = Math.min(segs.length - 1, Math.floor(u1 - 1e-9));
  for (let i = i0; i <= i1; i++) {
    const t0 = i === i0 ? u0 - i0 : 0;
    const t1 = i === i1 ? Math.min(1, u1 - i) : 1;
    if (t1 - t0 > 1e-9) out.push(segSub(segs[i], t0, t1));
  }
  return out;
}

/** 延長：境界図形まで伸ばす */
export function extend(doc: CadDocument, target: Entity, boundaries: Entity[], pick: Pt): Entity | null {
  if (target.type === 'line') {
    const a = { x: target.x1, y: target.y1 }, b = { x: target.x2, y: target.y2 };
    const nearEnd = dist(pick, b) < dist(pick, a);   // 伸ばす側
    const from = nearEnd ? a : b;
    const to = nearEnd ? b : a;
    let best: Pt | null = null, bestD = Infinity;
    for (const bd of boundaries) {
      if (bd.id === target.id) continue;
      for (const s of entSegs(doc, bd)) {
        const pts = s.kind === 'line'
          ? (() => { const x = lineLineX(a, b, s.a, s.b); return x && x.t2 >= -1e-9 && x.t2 <= 1 + 1e-9 ? [x.p] : []; })()
          : lineCircleX(a, b, s.c, s.r).filter((p) => onSeg(p, s));
        for (const p of pts) {
          const t = segParamOf({ kind: 'line', a: from, b: to }, p);
          if (t <= 1 + 1e-9) continue;         // 伸ばす方向にあるものだけ
          const d = dist(to, p);
          if (d < bestD) { bestD = d; best = p; }
        }
      }
    }
    if (!best) return null;
    return nearEnd
      ? { ...target, x2: best.x, y2: best.y, updated: Date.now() }
      : { ...target, x1: best.x, y1: best.y, updated: Date.now() };
  }
  if (target.type === 'arc') {
    const c = { x: target.cx, y: target.cy };
    const nearEnd = sweepCCW(target.a1, angleOf(c, pick)) > sweepCCW(target.a1, target.a2) / 2;
    let bestA: number | null = null, bestD = Infinity;
    for (const bd of boundaries) {
      if (bd.id === target.id) continue;
      for (const s of entSegs(doc, bd)) {
        const cseg: Seg = { kind: 'arc', c, r: target.r, a1: 0, a2: FULL_TURN, a: onCircle(c, target.r, 0), b: onCircle(c, target.r, 0) };
        for (const p of intersectSegs(cseg, s)) {
          const a = angleOf(c, p);
          if (angleInArc(a, target.a1, target.a2)) continue;
          const d = nearEnd ? sweepCCW(target.a2, a) : sweepCCW(a, target.a1);
          if (d < bestD) { bestD = d; bestA = a; }
        }
      }
    }
    if (bestA === null) return null;
    return nearEnd ? { ...target, a2: bestA, updated: Date.now() } : { ...target, a1: bestA, updated: Date.now() };
  }
  return null;
}

// -------------------------------------------------------- オフセット

/** オフセット：距離 d だけ離した平行図形。side は基準点で決める。 */
export function offset(doc: CadDocument, e: Entity, d: number, side: Pt): Entity | null {
  switch (e.type) {
    case 'line': {
      const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
      const n = qAngle(angleOf(a, b) + 90 * UDEG_PER_DEG);
      const f = perpFoot(side, a, b);
      const sgn = f ? Math.sign((side.x - f.x) * Math.cos((n / UDEG_PER_DEG) * Math.PI / 180) + (side.y - f.y) * Math.sin((n / UDEG_PER_DEG) * Math.PI / 180)) || 1 : 1;
      const na = polar(a, n, d * sgn), nb = polar(b, n, d * sgn);
      return { ...mkLine(doc, na, nb), layer: e.layer, color: e.color, linetype: e.linetype, lineweightUm: e.lineweightUm };
    }
    case 'circle': {
      const c = { x: e.cx, y: e.cy };
      const out = dist(side, c) > e.r;
      const r = out ? e.r + d : e.r - d;
      if (r <= 0) return null;
      return mkArcOrCircle(doc, e, r);
    }
    case 'arc': {
      const c = { x: e.cx, y: e.cy };
      const out = dist(side, c) > e.r;
      const r = out ? e.r + d : e.r - d;
      if (r <= 0) return null;
      return { ...mkArc(doc, c, r, e.a1, e.a2), layer: e.layer, color: e.color, linetype: e.linetype, lineweightUm: e.lineweightUm };
    }
    case 'polyline': {
      const segs = polySegs(e);
      if (!segs.length) return null;
      // 基準点がどちら側かを最近セグメントで判定
      let bi = 0, bd = Infinity;
      for (let i = 0; i < segs.length; i++) {
        const t = Math.min(1, Math.max(0, segParamOf(segs[i], side)));
        const dd = dist(segPointAt(segs[i], t), side);
        if (dd < bd) { bd = dd; bi = i; }
      }
      const ref = segs[bi];
      let sgn = 1;
      if (ref.kind === 'line') {
        const cr = (ref.b.x - ref.a.x) * (side.y - ref.a.y) - (ref.b.y - ref.a.y) * (side.x - ref.a.x);
        sgn = cr >= 0 ? 1 : -1;
      } else {
        sgn = dist(side, ref.c) > ref.r ? 1 : -1;
        const ccwOuter = 1;
        sgn *= ccwOuter;
      }
      const moved: Seg[] = segs.map((s) => {
        if (s.kind === 'line') {
          const n = qAngle(angleOf(s.a, s.b) + 90 * UDEG_PER_DEG);
          return { kind: 'line', a: polar(s.a, n, d * sgn), b: polar(s.b, n, d * sgn) };
        }
        const r = s.r + d * sgn * (isArcCCWOutward(s) ? 1 : -1);
        if (r <= 0) return s;
        return { kind: 'arc', c: s.c, r: q(r), a1: s.a1, a2: s.a2, a: onCircle(s.c, q(r), s.a1), b: onCircle(s.c, q(r), s.a2) };
      });
      // 隣接セグメントを交点で継ぐ
      const joined = joinSegs(moved, e.closed);
      const verts = joined.map((s) => {
        const a = s.kind === 'line' ? s.a : onCircle(s.c, s.r, s.a1);
        return { x: a.x, y: a.y, bulge: s.kind === 'arc' ? arcToBulge(sweepCCW(s.a1, s.a2)) : 0 };
      });
      if (!e.closed) {
        const last = joined[joined.length - 1];
        const p = last.kind === 'line' ? last.b : onCircle(last.c, last.r, last.a2);
        verts.push({ x: p.x, y: p.y, bulge: 0 });
      }
      return { ...mkPolyline(doc, verts, e.closed), layer: e.layer, color: e.color, linetype: e.linetype, lineweightUm: e.lineweightUm };
    }
    default: return null;
  }
}

function isArcCCWOutward(_s: Seg): boolean { return true; }

function mkArcOrCircle(doc: CadDocument, e: CircleEnt, r: number): CircleEnt {
  return { ...e, id: `e${doc.nextId++}`, r: q(r), created: Date.now(), updated: Date.now() };
}

/** 平行移動したセグメント列の隣接部を交点で繋ぎ直す */
function joinSegs(segs: Seg[], closed: boolean): Seg[] {
  const out = segs.map((s) => ({ ...s }));
  const n = out.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = out[i], b = out[(i + 1) % n];
    const x = intersectSegsInfinite(a, b);
    if (!x) continue;
    setSegEnd(a, x);
    setSegStart(b, x);
  }
  return out;
}

function setSegEnd(s: Seg, p: Pt): void {
  if (s.kind === 'line') s.b = p;
  else { s.a2 = angleOf(s.c, p); s.b = onCircle(s.c, s.r, s.a2); }
}
function setSegStart(s: Seg, p: Pt): void {
  if (s.kind === 'line') s.a = p;
  else { s.a1 = angleOf(s.c, p); s.a = onCircle(s.c, s.r, s.a1); }
}

function intersectSegsInfinite(a: Seg, b: Seg): Pt | null {
  if (a.kind === 'line' && b.kind === 'line') {
    const x = lineLineX(a.a, a.b, b.a, b.b);
    return x ? x.p : null;
  }
  if (a.kind === 'line' && b.kind === 'arc') {
    const pts = lineCircleX(a.a, a.b, b.c, b.r);
    return nearest(pts, a.b);
  }
  if (a.kind === 'arc' && b.kind === 'line') {
    const pts = lineCircleX(b.a, b.b, a.c, a.r);
    return nearest(pts, a.b);
  }
  const pts = circleCircleX((a as { c: Pt; r: number }).c, (a as { r: number }).r, (b as { c: Pt; r: number }).c, (b as { r: number }).r);
  return nearest(pts, (a as { b: Pt }).b);
}
function nearest(pts: Pt[], to: Pt): Pt | null {
  if (!pts.length) return null;
  return pts.reduce((best, p) => (dist(p, to) < dist(best, to) ? p : best));
}

// -------------------------------------------------------- フィレット／面取り

export interface FilletResult { arc: ArcEnt | null; e1: Entity; e2: Entity }

/** フィレット：2本の線の角を半径 r で丸める */
export function fillet(doc: CadDocument, l1: LineEnt, l2: LineEnt, r: number, p1: Pt, p2: Pt): FilletResult | null {
  const a1 = { x: l1.x1, y: l1.y1 }, b1 = { x: l1.x2, y: l1.y2 };
  const a2 = { x: l2.x1, y: l2.y1 }, b2 = { x: l2.x2, y: l2.y2 };
  const X = lineLineX(a1, b1, a2, b2);
  if (!X) return null;
  const c = X.p;
  // クリックした側を残す：残す端点は「クリック位置に近い方の端点」
  const keep1 = dist(p1, a1) <= dist(p1, b1) ? a1 : b1;
  const keep2 = dist(p2, a2) <= dist(p2, b2) ? a2 : b2;
  const dir1 = angleOf(c, keep1);
  const dir2 = angleOf(c, keep2);
  const half = Math.abs(angleDiffRad(dir1, dir2)) / 2;
  if (half < 1e-6 || Math.abs(half - Math.PI / 2) < 1e-12 && r === 0) return null;
  if (r === 0) {
    const nl1 = setLineEnd(l1, keep1, c), nl2 = setLineEnd(l2, keep2, c);
    return { arc: null, e1: nl1, e2: nl2 };
  }
  const tanDist = r / Math.tan(half);
  const t1 = polar(c, dir1, tanDist);
  const t2 = polar(c, dir2, tanDist);
  // 円弧の中心：角の二等分線上
  const bis = bisectAngle(dir1, dir2);
  const centerDist = r / Math.sin(half);
  const center = polar(c, bis, centerDist);
  let s1 = angleOf(center, t1), s2 = angleOf(center, t2);
  if (sweepCCW(s1, s2) > FULL_TURN / 2) { const t = s1; s1 = s2; s2 = t; }
  const arc = { ...mkArc(doc, center, r, s1, s2), layer: l1.layer, color: l1.color, linetype: l1.linetype, lineweightUm: l1.lineweightUm };
  return { arc, e1: setLineEnd(l1, keep1, t1), e2: setLineEnd(l2, keep2, t2) };
}

/** 面取り：2本の線の角を距離 d1,d2 で斜めに落とす */
export function chamfer(doc: CadDocument, l1: LineEnt, l2: LineEnt, d1: number, d2: number, p1: Pt, p2: Pt):
  { line: LineEnt; e1: Entity; e2: Entity } | null {
  const a1 = { x: l1.x1, y: l1.y1 }, b1 = { x: l1.x2, y: l1.y2 };
  const a2 = { x: l2.x1, y: l2.y1 }, b2 = { x: l2.x2, y: l2.y2 };
  const X = lineLineX(a1, b1, a2, b2);
  if (!X) return null;
  const c = X.p;
  const keep1 = dist(p1, a1) <= dist(p1, b1) ? a1 : b1;
  const keep2 = dist(p2, a2) <= dist(p2, b2) ? a2 : b2;
  const t1 = polar(c, angleOf(c, keep1), d1);
  const t2 = polar(c, angleOf(c, keep2), d2);
  const line = { ...mkLine(doc, t1, t2), layer: l1.layer, color: l1.color, linetype: l1.linetype, lineweightUm: l1.lineweightUm };
  return { line, e1: setLineEnd(l1, keep1, t1), e2: setLineEnd(l2, keep2, t2) };
}

function setLineEnd(l: LineEnt, keep: Pt, newEnd: Pt): LineEnt {
  const keepIsStart = keep.x === l.x1 && keep.y === l.y1;
  return keepIsStart
    ? { ...l, x2: newEnd.x, y2: newEnd.y, updated: Date.now() }
    : { ...l, x1: newEnd.x, y1: newEnd.y, updated: Date.now() };
}
function angleDiffRad(a: number, b: number): number {
  let d = ((a - b) / UDEG_PER_DEG) * Math.PI / 180;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
function bisectAngle(a: number, b: number): number {
  const ar = (a / UDEG_PER_DEG) * Math.PI / 180, br = (b / UDEG_PER_DEG) * Math.PI / 180;
  const x = Math.cos(ar) + Math.cos(br), y = Math.sin(ar) + Math.sin(br);
  return qAngle((Math.atan2(y, x) * 180 / Math.PI) * UDEG_PER_DEG);
}

// -------------------------------------------------------- 分解・結合

export function explode(doc: CadDocument, e: Entity): Entity[] {
  switch (e.type) {
    case 'polyline': {
      const out: Entity[] = [];
      for (const s of polySegs(e)) {
        out.push(...segsToEntities(doc, [s], e));
      }
      return out;
    }
    case 'insert': return explodeInsert(doc, e).map((x) => ({ ...x, id: `e${doc.nextId++}` }));
    case 'dim': {
      const g = dimGeometry(doc, e);
      const out: Entity[] = [];
      for (const l of g.lines) out.push({ ...mkLine(doc, l.a, l.b), layer: e.layer });
      for (const a of g.arcs) out.push({ ...mkArc(doc, a.c, a.r, a.a1, a.a2), layer: e.layer });
      for (const t of g.texts) {
        out.push({
          ...mkCommon(doc, { layer: e.layer }), type: 'text', x: t.p.x, y: t.p.y, text: t.text,
          h: t.h, rot: t.rotUDeg, font: 'sans-serif', halign: t.halign, valign: t.valign,
        });
      }
      return out;
    }
    default: return [];
  }
}

/** 結合：端点が一致する線・円弧をポリラインにまとめる */
export function join(doc: CadDocument, ents: Entity[]): { created: PolylineEnt[]; consumed: string[] } | null {
  const usable = ents.filter((e) => e.type === 'line' || e.type === 'arc' || e.type === 'polyline');
  if (usable.length < 2) return null;
  type Item = { id: string; segs: Seg[] };
  const items: Item[] = usable.map((e) => ({ id: e.id, segs: entSegs(doc, e) }));
  const used = new Set<string>();
  const created: PolylineEnt[] = [];
  const consumed: string[] = [];

  for (const start of items) {
    if (used.has(start.id)) continue;
    const chain: Seg[] = [...start.segs];
    used.add(start.id);
    const chainIds = [start.id];
    let grew = true;
    while (grew) {
      grew = false;
      const head = chainStart(chain), tail = chainEnd(chain);
      for (const it of items) {
        if (used.has(it.id)) continue;
        const s = chainStart(it.segs), t = chainEnd(it.segs);
        if (dist(tail, s) <= TOL.point) { chain.push(...it.segs); }
        else if (dist(tail, t) <= TOL.point) { chain.push(...reverseSegs(it.segs)); }
        else if (dist(head, t) <= TOL.point) { chain.unshift(...it.segs); }
        else if (dist(head, s) <= TOL.point) { chain.unshift(...reverseSegs(it.segs)); }
        else continue;
        used.add(it.id); chainIds.push(it.id); grew = true;
      }
    }
    if (chainIds.length < 2) { used.delete(start.id); continue; }
    const closed = dist(chainStart(chain), chainEnd(chain)) <= TOL.close;
    const verts = chain.map((s) => {
      const a = s.kind === 'line' ? s.a : onCircle(s.c, s.r, s.a1);
      return { x: a.x, y: a.y, bulge: s.kind === 'arc' ? arcToBulge(sweepCCW(s.a1, s.a2)) : 0 };
    });
    if (!closed) {
      const e2 = chainEnd(chain);
      verts.push({ x: e2.x, y: e2.y, bulge: 0 });
    }
    const proto = usable.find((e) => e.id === start.id)!;
    created.push({ ...mkPolyline(doc, verts, closed), layer: proto.layer, color: proto.color, linetype: proto.linetype, lineweightUm: proto.lineweightUm });
    consumed.push(...chainIds);
  }
  return created.length ? { created, consumed } : null;
}

function chainStart(segs: Seg[]): Pt { const s = segs[0]; return s.kind === 'line' ? s.a : onCircle(s.c, s.r, s.a1); }
function chainEnd(segs: Seg[]): Pt { const s = segs[segs.length - 1]; return s.kind === 'line' ? s.b : onCircle(s.c, s.r, s.a2); }
function reverseSegs(segs: Seg[]): Seg[] {
  return [...segs].reverse().map((s) => s.kind === 'line'
    ? { kind: 'line' as const, a: s.b, b: s.a }
    : { kind: 'arc' as const, c: s.c, r: s.r, a1: s.a2, a2: s.a1, a: s.b, b: s.a });
}

// -------------------------------------------------------- 配列複写

export function arrayRect(doc: CadDocument, ents: Entity[], cols: number, rows: number, dx: number, dy: number): Entity[] {
  const out: Entity[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r === 0 && c === 0) continue;
      const xf = xfTranslate(dx * c, dy * r);
      for (const e of ents) out.push({ ...transformEntity(doc, e, xf), id: `e${doc.nextId++}` });
    }
  }
  return out;
}

export function arrayPolar(doc: CadDocument, ents: Entity[], center: Pt, count: number, totalUDeg: number, rotateItems: boolean): Entity[] {
  const out: Entity[] = [];
  const step = totalUDeg / count;
  for (let i = 1; i < count; i++) {
    const xf = rotateItems ? xfRotate(step * i, center) : xfTranslate(
      polar(center, qAngle(step * i), 0).x, 0,
    );
    for (const e of ents) {
      if (rotateItems) out.push({ ...transformEntity(doc, e, xf), id: `e${doc.nextId++}` });
      else {
        const rot = xfRotate(step * i, center);
        const moved = transformEntity(doc, e, rot);
        const back = xfRotate(-step * i, { x: 0, y: 0 });
        void back;
        out.push({ ...moved, id: `e${doc.nextId++}` });
      }
    }
  }
  return out;
}

export { q, qAngle };
