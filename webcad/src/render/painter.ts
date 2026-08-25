/**
 * 描画の共通インターフェース。
 * 画面(Canvas2D)・SVG・PDF・印刷のすべてが同じ描画コードを通るため、
 * 「画面で見えているもの」と「出力されるもの」が食い違わない。
 * 座標はすべて図面座標(µm)で与える。
 */
import type { Pt } from '../core/geom.js';
import type { CadDocument, Entity, LineTypeName } from '../model/types.js';
import { effective, entSegs, ellipsePoints, explodeInsert } from '../model/doc.js';
import { dimGeometry } from './dim.js';
import { annotGeometry } from './annot.js';
import type { DimGeom } from './dim.js';
import { polar, onCircle } from '../core/geom.js';
import { qAngle, UDEG_PER_DEG } from '../core/units.js';

export interface StrokeStyle {
  color: string;
  /** 線幅 µm（図面上の実寸ではなく紙面上の太さ） */
  lwUm: number;
  linetype: LineTypeName;
  /** 破線パターンの1単位あたりの図面長さ(µm)。尺度に応じて変える。 */
  dashScale: number;
  opacity?: number;
}

export interface TextDraw {
  p: Pt; text: string; h: number; rotUDeg: number;
  halign: 'left' | 'center' | 'right';
  valign: 'base' | 'middle' | 'bottom' | 'top';
  color: string; font: string;
}

export interface Painter {
  beginPath(): void;
  moveTo(p: Pt): void;
  lineTo(p: Pt): void;
  arc(c: Pt, r: number, a1: number, a2: number): void;   // µdeg, 常に反時計回り
  closePath(): void;
  stroke(s: StrokeStyle): void;
  fillPath(color: string): void;
  text(t: TextDraw): void;
}

/** 線種のダッシュパターン（紙面mm単位） */
export const DASH_PATTERNS: Record<LineTypeName, number[]> = {
  CONTINUOUS: [],
  HIDDEN: [3, 1.5],
  CENTER: [10, 1.5, 2, 1.5],
  PHANTOM: [10, 1.5, 2, 1.5, 2, 1.5],
};

export interface DrawOptions {
  /** 図形ごとの色上書き（選択中・ハイライトなど） */
  overrideColor?: (e: Entity) => string | null;
  /** 尺度（1:2 なら 2）。破線ピッチと寸法文字の見た目倍率に使う。 */
  scaleDen?: number;
  /** 非表示レイヤも描くか */
  ignoreVisibility?: boolean;
  /** 印刷対象外レイヤを除外するか */
  printableOnly?: boolean;
}

export function strokeFor(doc: CadDocument, e: Entity, opt: DrawOptions): StrokeStyle {
  const ef = effective(doc, e);
  const over = opt.overrideColor?.(e) ?? null;
  return {
    color: over ?? ef.color,
    lwUm: ef.lw,
    linetype: ef.linetype,
    dashScale: (opt.scaleDen ?? 1) * 1000,
  };
}

/** 1つの図形を描く */
export function drawEntity(doc: CadDocument, e: Entity, p: Painter, opt: DrawOptions = {}): void {
  const ef = effective(doc, e);
  if (!opt.ignoreVisibility && !ef.visible) return;
  if (opt.printableOnly) {
    const layer = doc.layers.find((l) => l.name === e.layer);
    if (layer && !layer.printable) return;
  }
  const st = strokeFor(doc, e, opt);

  switch (e.type) {
    case 'line': case 'polyline': case 'circle': case 'arc': {
      p.beginPath();
      for (const s of entSegs(doc, e)) {
        if (s.kind === 'line') { p.moveTo(s.a); p.lineTo(s.b); }
        else p.arc(s.c, s.r, s.a1, s.a2);
      }
      p.stroke(st);
      break;
    }
    case 'ellipse': {
      const pts = ellipsePoints(e, 128);
      p.beginPath();
      p.moveTo(pts[0]);
      for (let i = 1; i < pts.length; i++) p.lineTo(pts[i]);
      p.stroke(st);
      break;
    }
    case 'point': {
      const d = 600;
      p.beginPath();
      p.moveTo({ x: e.x - d, y: e.y }); p.lineTo({ x: e.x + d, y: e.y });
      p.moveTo({ x: e.x, y: e.y - d }); p.lineTo({ x: e.x, y: e.y + d });
      p.stroke(st);
      break;
    }
    case 'text': {
      p.text({
        p: { x: e.x, y: e.y }, text: e.text, h: e.h, rotUDeg: e.rot,
        halign: e.halign, valign: e.valign, color: st.color, font: e.font,
      });
      break;
    }
    case 'insert': {
      for (const sub of explodeInsert(doc, e)) {
        drawEntity(doc, { ...sub, color: sub.color ?? e.color }, p, opt);
      }
      break;
    }
    case 'hatch': {
      drawHatch(doc, e.boundary, e.pattern, e.angle, e.spacing, p, st);
      break;
    }
    case 'gtol': case 'leader': case 'surf':
      drawDimGeom(annotGeometry(doc, e), p, st);
      break;
    case 'dim':
      drawDimGeom(dimGeometry(doc, e), p, st);
      break;
  }
}

/** 寸法・注記の描画プリミティブをまとめて描く */
export function drawDimGeom(g: DimGeom, p: Painter, st: StrokeStyle): void {
  p.beginPath();
  for (const l of g.lines) { p.moveTo(l.a); p.lineTo(l.b); }
  for (const a of g.arcs) p.arc(a.c, a.r, a.a1, a.a2);
  p.stroke(st);
  for (const a of g.arrows) {
    const back = qAngle(a.angleUDeg + 180 * UDEG_PER_DEG);
    const t1 = polar(a.p, qAngle(back + 9 * UDEG_PER_DEG), a.size);
    const t2 = polar(a.p, qAngle(back - 9 * UDEG_PER_DEG), a.size);
    p.beginPath(); p.moveTo(a.p); p.lineTo(t1); p.lineTo(t2); p.closePath();
    p.fillPath(st.color);
  }
  for (const t of g.texts) {
    p.text({ p: t.p, text: t.text, h: t.h, rotUDeg: t.rotUDeg, halign: t.halign, valign: t.valign, color: st.color, font: 'sans-serif' });
  }
}

/** ハッチング（断面の斜線）を境界の内側に描く */
export function drawHatch(
  doc: CadDocument, boundaryIds: string[], pattern: string, angle: number, spacing: number,
  p: Painter, st: StrokeStyle,
): void {
  const polys: Pt[][] = [];
  for (const id of boundaryIds) {
    const e = doc.entities.find((x) => x.id === id);
    if (!e) continue;
    polys.push(entityToPolygon(doc, e));
  }
  if (!polys.length) return;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const poly of polys) for (const q2 of poly) {
    x1 = Math.min(x1, q2.x); y1 = Math.min(y1, q2.y); x2 = Math.max(x2, q2.x); y2 = Math.max(y2, q2.y);
  }
  const diag = Math.hypot(x2 - x1, y2 - y1);
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const sp = Math.max(200, spacing);
  const angles = pattern === 'ANSI37' ? [angle, qAngle(angle + 90 * UDEG_PER_DEG)] : [angle];
  p.beginPath();
  for (const ang of angles) {
    const n = Math.ceil(diag / sp) + 1;
    for (let i = -n; i <= n; i++) {
      const base = polar({ x: cx, y: cy }, qAngle(ang + 90 * UDEG_PER_DEG), i * sp);
      const a = polar(base, ang, -diag), b = polar(base, ang, diag);
      const hits = clipSegmentByPolys(a, b, polys);
      for (const [s, t] of hits) { p.moveTo(s); p.lineTo(t); }
    }
  }
  p.stroke({ ...st, lwUm: Math.min(st.lwUm, 180) });
}

export function entityToPolygon(doc: CadDocument, e: Entity): Pt[] {
  const out: Pt[] = [];
  for (const s of entSegs(doc, e)) {
    if (s.kind === 'line') { if (!out.length) out.push(s.a); out.push(s.b); }
    else {
      const steps = 48;
      let sweep = (s.a2 - s.a1 + 360 * UDEG_PER_DEG) % (360 * UDEG_PER_DEG) || 360 * UDEG_PER_DEG;
      for (let i = 0; i <= steps; i++) out.push(onCircle(s.c, s.r, s.a1 + (sweep * i) / steps));
    }
  }
  return out;
}

/** 線分をポリゴン群でクリップ（偶奇規則） */
function clipSegmentByPolys(a: Pt, b: Pt, polys: Pt[][]): [Pt, Pt][] {
  const ts: number[] = [0, 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      const ex = p2.x - p1.x, ey = p2.y - p1.y;
      const den = dx * ey - dy * ex;
      if (den === 0) continue;
      const t = ((p1.x - a.x) * ey - (p1.y - a.y) * ex) / den;
      const u = ((p1.x - a.x) * dy - (p1.y - a.y) * dx) / den;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const tm = (ts[i] + ts[i + 1]) / 2;
    const mid = { x: a.x + dx * tm, y: a.y + dy * tm };
    if (polys.some((poly) => pointInPoly(mid, poly))) {
      out.push([{ x: a.x + dx * ts[i], y: a.y + dy * ts[i] }, { x: a.x + dx * ts[i + 1], y: a.y + dy * ts[i + 1] }]);
    }
  }
  return out;
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
