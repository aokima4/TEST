/**
 * スナップ（吸着）機能 — 仕様 5-2
 * 吸着範囲はズーム倍率に関係なく画面上 10px 固定。
 * 優先順位：端点 ＞ 交点 ＞ 中心 ＞ 中点 ＞ 四半点 ＞ 垂足 ＞ 接点 ＞ 延長交点
 */
import type { CadDocument, Entity } from '../model/types.js';
import type { Pt } from '../core/geom.js';
import {
  dist, onCircle, angleInArc, segSegX, lineLineX, lineCircleX, circleCircleX,
  perpFoot, tangentPoints, angleOf, closestOnSeg,
} from '../core/geom.js';
import { entSegs, closestOnSegAny, SpatialIndex } from '../model/doc.js';
import type { Seg } from '../model/doc.js';
import type { Viewport } from '../view/viewport.js';
import { UDEG_PER_DEG, q } from '../core/units.js';

export type SnapType =
  | 'endpoint' | 'intersection' | 'center' | 'midpoint' | 'quadrant'
  | 'perpendicular' | 'tangent' | 'extension' | 'nearest' | 'grid' | 'none';

export const SNAP_PRIORITY: SnapType[] = [
  'endpoint', 'intersection', 'center', 'midpoint', 'quadrant',
  'perpendicular', 'tangent', 'extension', 'grid', 'nearest',
];

export const SNAP_LABEL: Record<SnapType, string> = {
  endpoint: '端点', intersection: '交点', center: '中心', midpoint: '中点',
  quadrant: '四半点', perpendicular: '垂足', tangent: '接点', extension: '延長交点',
  nearest: '近接点', grid: 'グリッド', none: '',
};

export interface SnapSettings {
  enabled: boolean;
  types: Record<SnapType, boolean>;
  gridOn: boolean;
  gridSpacingUm: number;
  /** 吸着範囲(px) */
  rangePx: number;
}

export function defaultSnapSettings(): SnapSettings {
  return {
    enabled: true,
    types: {
      endpoint: true, intersection: true, center: true, midpoint: true, quadrant: true,
      perpendicular: true, tangent: true, extension: false, nearest: false, grid: true, none: false,
    },
    gridOn: false,
    gridSpacingUm: 10_000,
    rangePx: 10,
  };
}

export interface SnapHit { p: Pt; type: SnapType; entityId?: string }

/**
 * カーソル位置に最も適したスナップ点を求める。
 * @param ref 直前の確定点（垂足・接点の算出に使う）
 */
export function findSnap(
  doc: CadDocument, index: SpatialIndex, vp: Viewport, screen: { x: number; y: number },
  s: SnapSettings, ref: Pt | null, exclude: Set<string> = new Set(),
): SnapHit | null {
  if (!s.enabled) return null;
  const world = vp.toWorldRaw(screen.x, screen.y);
  const rangeUm = vp.pxToUm(s.rangePx);
  const box = { x1: world.x - rangeUm * 3, y1: world.y - rangeUm * 3, x2: world.x + rangeUm * 3, y2: world.y + rangeUm * 3 };
  const ids = [...index.query(box)].filter((id) => !exclude.has(id));
  const ents = ids.map((id) => doc.entities.find((e) => e.id === id)).filter((e): e is Entity => {
    if (!e) return false;
    const layer = doc.layers.find((l) => l.name === e.layer);
    return !layer || layer.visible;
  }).slice(0, 200);

  const cands: SnapHit[] = [];
  const push = (p: Pt, type: SnapType, entityId?: string): void => {
    if (!s.types[type]) return;
    if (dist(p, world) <= rangeUm) cands.push({ p, type, entityId });
  };

  const segsOf = new Map<string, Seg[]>();
  for (const e of ents) segsOf.set(e.id, entSegs(doc, e));

  for (const e of ents) {
    const segs = segsOf.get(e.id)!;
    if (e.type === 'point') push({ x: e.x, y: e.y }, 'endpoint', e.id);
    if (e.type === 'text') push({ x: e.x, y: e.y }, 'endpoint', e.id);
    if (e.type === 'insert') push({ x: e.x, y: e.y }, 'endpoint', e.id);
    if (e.type === 'dim') { push(e.p1, 'endpoint', e.id); push(e.p2, 'endpoint', e.id); }

    for (const seg of segs) {
      if (seg.kind === 'line') {
        push(seg.a, 'endpoint', e.id);
        push(seg.b, 'endpoint', e.id);
        push({ x: q((seg.a.x + seg.b.x) / 2), y: q((seg.a.y + seg.b.y) / 2) }, 'midpoint', e.id);
        if (ref) {
          const f = perpFoot(ref, seg.a, seg.b);
          if (f) push(f, 'perpendicular', e.id);
        }
        push(closestOnSeg(world, seg.a, seg.b), 'nearest', e.id);
      } else {
        push(seg.c, 'center', e.id);
        if (e.type !== 'circle') { push(seg.a, 'endpoint', e.id); push(seg.b, 'endpoint', e.id); }
        // 四半点
        for (let k = 0; k < 4; k++) {
          const a = k * 90 * UDEG_PER_DEG;
          if (e.type === 'circle' || angleInArc(a, seg.a1, seg.a2)) push(onCircle(seg.c, seg.r, a), 'quadrant', e.id);
        }
        // 円弧の中点
        if (e.type !== 'circle') {
          const mid = ((seg.a2 - seg.a1 + 360 * UDEG_PER_DEG) % (360 * UDEG_PER_DEG)) / 2 + seg.a1;
          push(onCircle(seg.c, seg.r, mid), 'midpoint', e.id);
        }
        if (ref) {
          for (const tp of tangentPoints(ref, seg.c, seg.r)) {
            if (e.type === 'circle' || angleInArc(angleOf(seg.c, tp), seg.a1, seg.a2)) push(tp, 'tangent', e.id);
          }
          // 円への垂足＝中心方向の最近点
          const d = dist(ref, seg.c);
          if (d > 1) {
            const f = onCircle(seg.c, seg.r, angleOf(seg.c, ref));
            if (e.type === 'circle' || angleInArc(angleOf(seg.c, f), seg.a1, seg.a2)) push(f, 'perpendicular', e.id);
          }
        }
        push(closestOnSegAny(world, seg), 'nearest', e.id);
      }
    }
  }

  // 交点・延長交点
  if (s.types.intersection || s.types.extension) {
    for (let i = 0; i < ents.length; i++) {
      for (let j = i + 1; j < ents.length; j++) {
        const A = segsOf.get(ents[i].id)!, B = segsOf.get(ents[j].id)!;
        for (const a of A) for (const b of B) {
          for (const p of segIntersections(a, b)) push(p, 'intersection', ents[i].id);
          if (s.types.extension && a.kind === 'line' && b.kind === 'line') {
            const x = lineLineX(a.a, a.b, b.a, b.b);
            if (x && (x.t1 < 0 || x.t1 > 1 || x.t2 < 0 || x.t2 > 1)) push(x.p, 'extension', ents[i].id);
          }
        }
      }
    }
  }

  // グリッド
  if (s.gridOn && s.types.grid) {
    const g = s.gridSpacingUm;
    const gp = { x: Math.round(world.x / g) * g, y: Math.round(world.y / g) * g };
    push(gp, 'grid');
  }

  if (!cands.length) return null;
  // 優先順位 → 同順位ならカーソルに近い方
  cands.sort((a, b) => {
    const pa = SNAP_PRIORITY.indexOf(a.type), pb = SNAP_PRIORITY.indexOf(b.type);
    if (pa !== pb) return pa - pb;
    return dist(a.p, world) - dist(b.p, world);
  });
  return cands[0];
}

/** 2つのセグメントの交点をすべて求める */
export function segIntersections(a: Seg, b: Seg): Pt[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const p = segSegX(a.a, a.b, b.a, b.b);
    return p ? [p] : [];
  }
  if (a.kind === 'line' && b.kind === 'arc') return lineArcX(a, b);
  if (a.kind === 'arc' && b.kind === 'line') return lineArcX(b, a);
  // 円弧×円弧
  const pts = circleCircleX((a as Extract<Seg, { kind: 'arc' }>).c, (a as Extract<Seg, { kind: 'arc' }>).r,
    (b as Extract<Seg, { kind: 'arc' }>).c, (b as Extract<Seg, { kind: 'arc' }>).r);
  return pts.filter((p) => onArcSeg(p, a as Extract<Seg, { kind: 'arc' }>) && onArcSeg(p, b as Extract<Seg, { kind: 'arc' }>));
}

function lineArcX(l: Extract<Seg, { kind: 'line' }>, a: Extract<Seg, { kind: 'arc' }>): Pt[] {
  const pts = lineCircleX(l.a, l.b, a.c, a.r);
  return pts.filter((p) => onLineSeg(p, l) && onArcSeg(p, a));
}

function onLineSeg(p: Pt, l: Extract<Seg, { kind: 'line' }>): boolean {
  const d = dist(l.a, l.b);
  if (d === 0) return false;
  const t = ((p.x - l.a.x) * (l.b.x - l.a.x) + (p.y - l.a.y) * (l.b.y - l.a.y)) / (d * d);
  return t >= -1e-9 && t <= 1 + 1e-9;
}
function onArcSeg(p: Pt, a: Extract<Seg, { kind: 'arc' }>): boolean {
  const full = ((a.a2 - a.a1) % (360 * UDEG_PER_DEG) + 360 * UDEG_PER_DEG) % (360 * UDEG_PER_DEG);
  if (full === 0) return true; // 完全な円
  return angleInArc(angleOf(a.c, p), a.a1, a.a2);
}

/** スナップ種別に応じたマーカーを描く（□端点 △中点 ○中心 ×交点 …） */
export function drawSnapMarker(ctx: CanvasRenderingContext2D, x: number, y: number, type: SnapType, color = '#38ff9a'): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  const r = 6;
  ctx.beginPath();
  switch (type) {
    case 'endpoint': ctx.strokeRect(x - r, y - r, r * 2, r * 2); break;
    case 'midpoint':
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); ctx.stroke(); break;
    case 'center': ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke(); break;
    case 'intersection':
      ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
      ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke(); break;
    case 'quadrant':
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.stroke(); break;
    case 'perpendicular':
      ctx.moveTo(x - r, y - r); ctx.lineTo(x - r, y + r); ctx.lineTo(x + r, y + r);
      ctx.moveTo(x - r, y + 1); ctx.lineTo(x + 1, y + 1); ctx.lineTo(x + 1, y + r); ctx.stroke(); break;
    case 'tangent':
      ctx.arc(x, y + 2, r - 1, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r, y - r + 1); ctx.lineTo(x + r, y - r + 1); ctx.stroke(); break;
    case 'extension':
      ctx.setLineDash([2, 2]);
      ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
      ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); ctx.stroke(); break;
    case 'grid':
      ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke(); break;
    default:
      ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}
