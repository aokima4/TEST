/** コマンド定義（仕様 5-4 / 6章 / 4章）。ジェネレータで対話手順を記述する。 */
import type { App, CommandDef, Req, Command } from './app.js';
import type { Entity, LineEnt, CircleEnt, ArcEnt, PolylineEnt, DimEnt, DimKind, ConstraintType, Constraint, Handle, GtolSymbol } from '../model/types.js';
import { GTOL_SYMBOLS } from '../render/annot.js';
import type { Pt } from '../core/geom.js';
import {
  pt, dist, angleOf, polar, onCircle, circleFrom3, arcFrom3, sweepCCW, lineLineX,
  circleCircleX, tangentPoints, xfMirror,
} from '../core/geom.js';
import { q, qAngle, UDEG_PER_DEG, mmToUm, degToUDeg, fmtMM } from '../core/units.js';
import { mkLine, mkCircle, mkArc, mkPolyline, mkText, mkPoint, mkCommon, transformEntity, entSegs, docBBox } from '../model/doc.js';
import {
  moveXf, rotateXf, scaleXf, mirrorXf, trim, extend, offset, fillet, chamfer, explode, join,
  arrayRect, arrayPolar,
} from '../ops/edit.js';
import type { Painter, StrokeStyle } from '../render/painter.js';
import { drawEntity } from '../render/painter.js';

const PREVIEW: StrokeStyle = { color: '#ffd24a', lwUm: 200, linetype: 'CONTINUOUS', dashScale: 1000 };
const line = (p: Painter, a: Pt, b: Pt): void => { p.beginPath(); p.moveTo(a); p.lineTo(b); p.stroke(PREVIEW); };
const circle = (p: Painter, c: Pt, r: number): void => { p.beginPath(); p.arc(c, r, 0, 360 * UDEG_PER_DEG); p.stroke(PREVIEW); };
const arcPv = (p: Painter, c: Pt, r: number, a1: number, a2: number): void => { p.beginPath(); p.arc(c, r, a1, a2); p.stroke(PREVIEW); };

type Yielded = Pt & { keyword?: string } | { entity: Entity; point: Pt } | Entity[] | number | string | null;

/** よく使う入力ヘルパ */
const P = (prompt: string, base?: Pt | null, preview?: Req extends never ? never : ((p: Pt, painter: Painter, ctx: CanvasRenderingContext2D) => void), keywords?: string[]): Req =>
  ({ kind: 'point', prompt, base, preview, keywords });
const N = (prompt: string, def?: number): Req => ({ kind: 'number', prompt, default: def });
const A = (prompt: string, def?: number): Req => ({ kind: 'number', prompt, default: def, unit: 'deg' });
const E = (prompt: string, filter?: (e: Entity) => boolean): Req => ({ kind: 'entity', prompt, filter });
const ES = (prompt: string, filter?: (e: Entity) => boolean): Req => ({ kind: 'entities', prompt, filter });
const T = (prompt: string, def?: string): Req => ({ kind: 'text', prompt, default: def });
const K = (prompt: string, options: { key: string; label: string }[]): Req => ({ kind: 'keyword', prompt, options });

// ============================================================ 作図コマンド

function* cmdLine(app: App): Generator<Req, void, any> {
  let prev = (yield P('線の始点を指定')) as Pt;
  if (!prev) return;
  for (;;) {
    const next = (yield P('次の点を指定（Enter/右クリックで終了）', prev,
      (p, painter) => line(painter, prev, p))) as Pt | null;
    if (!next) return;
    const a = prev, b = next;
    app.store.tx('線', () => { app.store.add(mkLine(app.doc, a, b)); });
    prev = next;
  }
}

function* cmdPolyline(app: App): Generator<Req, void, any> {
  const verts: Pt[] = [];
  const first = (yield P('ポリラインの始点を指定')) as Pt;
  if (!first) return;
  verts.push(first);
  for (;;) {
    const r = (yield P('次の点（C=閉じる / Enterで終了）', verts[verts.length - 1],
      (p, painter) => {
        painter.beginPath();
        painter.moveTo(verts[0]);
        for (let i = 1; i < verts.length; i++) painter.lineTo(verts[i]);
        painter.lineTo(p);
        painter.stroke(PREVIEW);
      }, ['C'])) as (Pt & { keyword?: string }) | null;
    if (r && (r as { keyword?: string }).keyword === 'C') {
      if (verts.length >= 3) {
        app.store.tx('ポリライン', () => { app.store.add(mkPolyline(app.doc, verts, true)); });
      }
      return;
    }
    if (!r) {
      if (verts.length >= 2) app.store.tx('ポリライン', () => { app.store.add(mkPolyline(app.doc, verts, false)); });
      return;
    }
    verts.push(r as Pt);
  }
}

function* cmdCircle(app: App): Generator<Req, void, any> {
  const mode = (yield K('円の作図方法', [
    { key: 'C', label: '中心-半径' }, { key: '2', label: '直径2点' },
    { key: '3', label: '円周3点' }, { key: 'T', label: '接接半' },
  ])) as string;
  if (mode === 'C') {
    const c = (yield P('円の中心を指定')) as Pt;
    if (!c) return;
    const rp = (yield P('半径を指定（数値入力も可）', c, (p, painter) => circle(painter, c, dist(c, p)))) as Pt | null;
    if (!rp) return;
    const r = q(dist(c, rp));
    if (r <= 0) return;
    app.store.tx('円', () => { app.store.add(mkCircle(app.doc, c, r)); });
  } else if (mode === '2') {
    const a = (yield P('直径の1点目')) as Pt;
    if (!a) return;
    const b = (yield P('直径の2点目', a, (p, painter) => circle(painter, pt((a.x + p.x) / 2, (a.y + p.y) / 2), dist(a, p) / 2))) as Pt;
    if (!b) return;
    app.store.tx('円', () => { app.store.add(mkCircle(app.doc, pt((a.x + b.x) / 2, (a.y + b.y) / 2), q(dist(a, b) / 2))); });
  } else if (mode === '3') {
    const a = (yield P('円周上の1点目')) as Pt;
    const b = (yield P('円周上の2点目', a)) as Pt;
    const c = (yield P('円周上の3点目', b, (p, painter) => {
      const cir = circleFrom3(a, b, p);
      if (cir) circle(painter, cir.c, cir.r);
    })) as Pt;
    if (!a || !b || !c) return;
    const cir = circleFrom3(a, b, c);
    if (!cir) { app.setStatus('3点が一直線上にあるため円を作れません'); return; }
    app.store.tx('円', () => { app.store.add(mkCircle(app.doc, cir.c, cir.r)); });
  } else {
    const e1 = (yield E('1つ目の接する図形を選択')) as { entity: Entity; point: Pt };
    const e2 = (yield E('2つ目の接する図形を選択')) as { entity: Entity; point: Pt };
    const r = (yield N('半径 (mm)')) as number;
    if (!e1 || !e2 || !r) return;
    const c = tangentTangentRadius(app, e1, e2, r);
    if (!c) { app.setStatus('その半径では接する円を作れません'); return; }
    app.store.tx('円（接接半）', () => { app.store.add(mkCircle(app.doc, c, r)); });
  }
}

function tangentTangentRadius(app: App, a: { entity: Entity; point: Pt }, b: { entity: Entity; point: Pt }, r: number): Pt | null {
  const off = (e: Entity, side: Pt, d: number): { kind: 'lines'; a: Pt; b: Pt }[] | { kind: 'circle'; c: Pt; r: number }[] | null => null;
  void off;
  // 2直線の場合：両方から距離rの平行線の交点
  if (a.entity.type === 'line' && b.entity.type === 'line') {
    const L1 = a.entity, L2 = b.entity;
    const cands: Pt[] = [];
    for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
      const n1 = qAngle(angleOf({ x: L1.x1, y: L1.y1 }, { x: L1.x2, y: L1.y2 }) + 90 * UDEG_PER_DEG);
      const n2 = qAngle(angleOf({ x: L2.x1, y: L2.y1 }, { x: L2.x2, y: L2.y2 }) + 90 * UDEG_PER_DEG);
      const p1 = polar({ x: L1.x1, y: L1.y1 }, n1, r * s1), p2 = polar({ x: L1.x2, y: L1.y2 }, n1, r * s1);
      const p3 = polar({ x: L2.x1, y: L2.y1 }, n2, r * s2), p4 = polar({ x: L2.x2, y: L2.y2 }, n2, r * s2);
      const x = lineLineX(p1, p2, p3, p4);
      if (x) cands.push(x.p);
    }
    if (!cands.length) return null;
    const target = pt((a.point.x + b.point.x) / 2, (a.point.y + b.point.y) / 2);
    return cands.reduce((best, p) => (dist(p, target) < dist(best, target) ? p : best));
  }
  // 円が絡む場合：中心からの距離が r±R の円同士の交点
  const circles = [a, b].map((h) => {
    const e = h.entity;
    if (e.type === 'circle' || e.type === 'arc') return { c: { x: e.cx, y: e.cy }, r: e.r, pick: h.point };
    return null;
  });
  if (circles[0] && circles[1]) {
    const cands: Pt[] = [];
    for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
      const r1 = circles[0].r + r * s1, r2 = circles[1].r + r * s2;
      if (r1 <= 0 || r2 <= 0) continue;
      cands.push(...circleCircleX(circles[0].c, r1, circles[1].c, r2));
    }
    if (!cands.length) return null;
    const target = pt((a.point.x + b.point.x) / 2, (a.point.y + b.point.y) / 2);
    return cands.reduce((best, p) => (dist(p, target) < dist(best, target) ? p : best));
  }
  void app;
  return null;
}

function* cmdArc(app: App): Generator<Req, void, any> {
  const mode = (yield K('円弧の作図方法', [
    { key: '3', label: '3点' }, { key: 'C', label: '中心-始点-終点' },
  ])) as string;
  if (mode === '3') {
    const a = (yield P('始点')) as Pt;
    const b = (yield P('通過点', a)) as Pt;
    const c = (yield P('終点', b, (p, painter) => {
      const r = arcFrom3(a, b, p);
      if (r) arcPv(painter, r.c, r.r, r.a1, r.a2);
    })) as Pt;
    if (!a || !b || !c) return;
    const r = arcFrom3(a, b, c);
    if (!r) { app.setStatus('3点が一直線上にあるため円弧を作れません'); return; }
    app.store.tx('円弧', () => { app.store.add(mkArc(app.doc, r.c, r.r, r.a1, r.a2)); });
  } else {
    const c = (yield P('中心')) as Pt;
    const s = (yield P('始点', c, (p, painter) => circle(painter, c, dist(c, p)))) as Pt;
    if (!c || !s) return;
    const r = q(dist(c, s));
    const a1 = angleOf(c, s);
    const e2 = (yield P('終点（反時計回り）', c, (p, painter) => arcPv(painter, c, r, a1, angleOf(c, p)))) as Pt;
    if (!e2) return;
    app.store.tx('円弧', () => { app.store.add(mkArc(app.doc, c, r, a1, angleOf(c, e2))); });
  }
}

function* cmdRect(app: App): Generator<Req, void, any> {
  const a = (yield P('矩形の1隅を指定')) as Pt;
  if (!a) return;
  const b = (yield P('対角の隅を指定（数値は「幅,高さ」）', a, (p, painter) => {
    painter.beginPath();
    painter.moveTo(a); painter.lineTo({ x: p.x, y: a.y }); painter.lineTo(p); painter.lineTo({ x: a.x, y: p.y }); painter.closePath();
    painter.stroke(PREVIEW);
  })) as Pt;
  if (!b) return;
  app.store.tx('矩形', () => {
    app.store.add(mkPolyline(app.doc, [
      { x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y },
    ], true));
  });
}

function* cmdPolygon(app: App): Generator<Req, void, any> {
  const n = (yield { kind: 'number', prompt: '辺の数', default: 6, unit: 'raw' } as Req) as number;
  const sides = Math.max(3, Math.min(1024, Math.round(n)));
  const c = (yield P('中心を指定')) as Pt;
  if (!c) return;
  const mode = (yield K('基準', [{ key: 'I', label: '内接（頂点まで）' }, { key: 'C', label: '外接（辺まで）' }])) as string;
  const rp = (yield P('半径を指定', c, (p, painter) => {
    const pts = polygonPts(c, dist(c, p), sides, angleOf(c, p), mode === 'C');
    painter.beginPath();
    painter.moveTo(pts[0]);
    for (const v of pts.slice(1)) painter.lineTo(v);
    painter.closePath();
    painter.stroke(PREVIEW);
  })) as Pt;
  if (!rp) return;
  const pts = polygonPts(c, dist(c, rp), sides, angleOf(c, rp), mode === 'C');
  app.store.tx('正多角形', () => { app.store.add(mkPolyline(app.doc, pts, true)); });
}

function polygonPts(c: Pt, r: number, n: number, startAngle: number, circumscribed: boolean): Pt[] {
  const rr = circumscribed ? r / Math.cos(Math.PI / n) : r;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(onCircle(c, rr, qAngle(startAngle + (360 * UDEG_PER_DEG * i) / n)));
  return out;
}

function* cmdText(app: App): Generator<Req, void, any> {
  const p = (yield P('文字の挿入点')) as Pt;
  if (!p) return;
  const h = (yield N('文字高さ (mm)', mmToUm(3.5))) as number;
  const rot = (yield A('回転角 (度)', 0)) as number;
  const s = (yield T('文字列')) as string;
  if (!s) return;
  app.store.tx('文字', () => { app.store.add(mkText(app.doc, p, s, h, rot)); });
}

function* cmdPoint(app: App): Generator<Req, void, any> {
  for (;;) {
    const p = (yield P('点の位置（Enterで終了）')) as Pt | null;
    if (!p) return;
    app.store.tx('点', () => { app.store.add(mkPoint(app.doc, p)); });
  }
}

function* cmdEllipse(app: App): Generator<Req, void, any> {
  const c = (yield P('楕円の中心')) as Pt;
  if (!c) return;
  const a = (yield P('長軸の端点', c, (p, painter) => line(painter, c, p))) as Pt;
  if (!a) return;
  const b = (yield P('短軸の半径', c, (p, painter) => {
    painter.beginPath();
    const maj = dist(c, a), min = dist(c, p);
    const rot = angleOf(c, a);
    for (let i = 0; i <= 64; i++) {
      const t = (i / 64) * Math.PI * 2;
      const x = maj * Math.cos(t), y = min * Math.sin(t);
      const rr = (rot / UDEG_PER_DEG) * Math.PI / 180;
      const q2 = { x: c.x + x * Math.cos(rr) - y * Math.sin(rr), y: c.y + x * Math.sin(rr) + y * Math.cos(rr) };
      if (i === 0) painter.moveTo(q2); else painter.lineTo(q2);
    }
    painter.stroke(PREVIEW);
  })) as Pt;
  if (!b) return;
  const maj = dist(c, a), min = dist(c, b);
  app.store.tx('楕円', () => {
    app.store.add({
      ...mkCommon(app.doc), type: 'ellipse', cx: c.x, cy: c.y,
      majX: a.x - c.x, majY: a.y - c.y, ratio: Math.round((min / Math.max(1, maj)) * 1e6),
      a1: 0, a2: 360 * UDEG_PER_DEG,
    });
  });
}

// ============================================================ 編集コマンド

function* cmdMove(app: App): Generator<Req, void, any> {
  const ents = (yield ES('移動する図形を選択')) as Entity[];
  if (!ents?.length) return;
  const base = (yield P('基点を指定')) as Pt;
  if (!base) return;
  const to = (yield P('移動先を指定', base, (p, painter) => {
    for (const e of ents) previewEntity(app, painter, transformEntity(app.doc, e, moveXf(p.x - base.x, p.y - base.y)));
  })) as Pt;
  if (!to) return;
  const xf = moveXf(to.x - base.x, to.y - base.y);
  app.store.tx('移動', () => { for (const e of ents) app.store.update(transformEntity(app.doc, e, xf)); });
}

function* cmdCopy(app: App): Generator<Req, void, any> {
  const ents = (yield ES('複写する図形を選択')) as Entity[];
  if (!ents?.length) return;
  const base = (yield P('基点を指定')) as Pt;
  if (!base) return;
  for (;;) {
    const to = (yield P('複写先を指定（Enterで終了）', base, (p, painter) => {
      for (const e of ents) previewEntity(app, painter, transformEntity(app.doc, e, moveXf(p.x - base.x, p.y - base.y)));
    })) as Pt | null;
    if (!to) return;
    const xf = moveXf(to.x - base.x, to.y - base.y);
    app.store.tx('複写', () => {
      for (const e of ents) app.store.add({ ...transformEntity(app.doc, e, xf), id: app.store.newId() });
    });
  }
}

function* cmdRotate(app: App): Generator<Req, void, any> {
  const ents = (yield ES('回転する図形を選択')) as Entity[];
  if (!ents?.length) return;
  const base = (yield P('回転の中心')) as Pt;
  if (!base) return;
  const ang = (yield P('回転角（数値入力可）', base, (p, painter) => {
    const a = angleOf(base, p);
    for (const e of ents) previewEntity(app, painter, transformEntity(app.doc, e, rotateXf(base, a)));
  })) as Pt | number;
  if (ang === null || ang === undefined) return;
  const udeg = typeof ang === 'number' ? ang : angleOf(base, ang as Pt);
  const xf = rotateXf(base, udeg);
  app.store.tx('回転', () => { for (const e of ents) app.store.update(transformEntity(app.doc, e, xf)); });
}

function* cmdScale(app: App): Generator<Req, void, any> {
  const ents = (yield ES('拡大縮小する図形を選択')) as Entity[];
  if (!ents?.length) return;
  const base = (yield P('基点を指定')) as Pt;
  if (!base) return;
  const f = (yield { kind: 'number', prompt: '倍率', default: 1, unit: 'raw' } as Req) as number;
  if (!f || f <= 0) return;
  const xf = scaleXf(base, f);
  app.store.tx('拡大縮小', () => { for (const e of ents) app.store.update(transformEntity(app.doc, e, xf)); });
}

function* cmdMirror(app: App): Generator<Req, void, any> {
  const ents = (yield ES('鏡像にする図形を選択')) as Entity[];
  if (!ents?.length) return;
  const a = (yield P('対称軸の1点目')) as Pt;
  if (!a) return;
  const b = (yield P('対称軸の2点目', a, (p, painter) => {
    line(painter, a, p);
    for (const e of ents) previewEntity(app, painter, transformEntity(app.doc, e, mirrorXf(a, p)));
  })) as Pt;
  if (!b) return;
  const del = (yield K('元の図形を削除しますか', [{ key: 'N', label: '残す' }, { key: 'Y', label: '削除' }])) as string;
  const xf = mirrorXf(a, b);
  app.store.tx('鏡像', () => {
    for (const e of ents) {
      app.store.add({ ...transformEntity(app.doc, e, xf), id: app.store.newId() });
      if (del === 'Y') app.store.remove(e.id);
    }
  });
}

function* cmdOffset(app: App): Generator<Req, void, any> {
  const d = (yield N('オフセット距離 (mm)')) as number;
  if (!d) return;
  for (;;) {
    const sel = (yield E('オフセットする図形を選択（Escで終了）')) as { entity: Entity; point: Pt } | null;
    if (!sel) return;
    const side = (yield P('どちら側にずらすか指定', null, (p, painter) => {
      const r = offset(app.doc, sel.entity, d, p);
      if (r) previewEntity(app, painter, r);
    })) as Pt;
    if (!side) return;
    const r = offset(app.doc, sel.entity, d, side);
    if (!r) { app.setStatus('この図形はオフセットできません'); continue; }
    app.store.tx('オフセット', () => { app.store.add(r); });
  }
}

function* cmdTrim(app: App): Generator<Req, void, any> {
  const cutters = (yield ES('切り取りの基準となる図形を選択（Enterで全図形）')) as Entity[];
  const cutSet = cutters?.length ? cutters : app.doc.entities;
  app.selection.clear();
  for (;;) {
    const sel = (yield E('切り取る部分をクリック（Escで終了）')) as { entity: Entity; point: Pt } | null;
    if (!sel) return;
    const res = trim(app.doc, sel.entity, cutSet, sel.point);
    if (res === null) { app.setStatus('交点が見つからないため切り取れません'); continue; }
    app.store.tx('トリム', () => {
      app.store.remove(sel.entity.id);
      for (const e of res) app.store.add(e);
    });
  }
}

function* cmdExtend(app: App): Generator<Req, void, any> {
  const bounds = (yield ES('境界となる図形を選択（Enterで全図形）')) as Entity[];
  const bs = bounds?.length ? bounds : app.doc.entities;
  app.selection.clear();
  for (;;) {
    const sel = (yield E('延長する図形の端側をクリック（Escで終了）')) as { entity: Entity; point: Pt } | null;
    if (!sel) return;
    const res = extend(app.doc, sel.entity, bs, sel.point);
    if (!res) { app.setStatus('延長先が見つかりません'); continue; }
    app.store.tx('延長', () => { app.store.update(res); });
  }
}

function* cmdFillet(app: App): Generator<Req, void, any> {
  const r = (yield N('フィレット半径 (mm)', mmToUm(5))) as number;
  for (;;) {
    const a = (yield E('1本目の線を選択（Escで終了）', (e) => e.type === 'line')) as { entity: LineEnt; point: Pt } | null;
    if (!a) return;
    const b = (yield E('2本目の線を選択', (e) => e.type === 'line')) as { entity: LineEnt; point: Pt } | null;
    if (!b) return;
    const res = fillet(app.doc, a.entity, b.entity, r, a.point, b.point);
    if (!res) { app.setStatus('この2線はフィレットできません（平行など）'); continue; }
    app.store.tx('フィレット', () => {
      app.store.update(res.e1); app.store.update(res.e2);
      if (res.arc) app.store.add(res.arc);
    });
  }
}

function* cmdChamfer(app: App): Generator<Req, void, any> {
  const d1 = (yield N('面取り距離1 (mm)', mmToUm(2))) as number;
  const d2 = (yield N('面取り距離2 (mm)', d1)) as number;
  for (;;) {
    const a = (yield E('1本目の線を選択（Escで終了）', (e) => e.type === 'line')) as { entity: LineEnt; point: Pt } | null;
    if (!a) return;
    const b = (yield E('2本目の線を選択', (e) => e.type === 'line')) as { entity: LineEnt; point: Pt } | null;
    if (!b) return;
    const res = chamfer(app.doc, a.entity, b.entity, d1, d2, a.point, b.point);
    if (!res) { app.setStatus('この2線は面取りできません'); continue; }
    app.store.tx('面取り', () => {
      app.store.update(res.e1); app.store.update(res.e2); app.store.add(res.line);
    });
  }
}

function* cmdExplode(app: App): Generator<Req, void, any> {
  const ents = (yield ES('分解する図形を選択')) as Entity[];
  if (!ents?.length) return;
  app.store.tx('分解', () => {
    for (const e of ents) {
      const parts = explode(app.doc, e);
      if (!parts.length) continue;
      app.store.remove(e.id);
      for (const p of parts) app.store.add({ ...p, id: app.store.newId() });
    }
  });
  app.selection.clear();
}

function* cmdJoin(app: App): Generator<Req, void, any> {
  const ents = (yield ES('結合する図形を選択')) as Entity[];
  if (!ents || ents.length < 2) return;
  const res = join(app.doc, ents);
  if (!res) { app.setStatus('端点が一致していないため結合できません'); return; }
  app.store.tx('結合', () => {
    for (const id of res.consumed) app.store.remove(id);
    for (const e of res.created) app.store.add(e);
  });
  app.selection.clear();
}

function* cmdErase(app: App): Generator<Req, void, any> {
  const ents = (yield ES('削除する図形を選択')) as Entity[];
  if (!ents?.length) return;
  app.store.tx('削除', () => { for (const e of ents) app.store.remove(e.id); });
  app.selection.clear();
}

function* cmdArrayRect(app: App): Generator<Req, void, any> {
  const ents = (yield ES('配列複写する図形を選択')) as Entity[];
  if (!ents?.length) return;
  const cols = (yield { kind: 'number', prompt: '列数（横）', default: 3, unit: 'raw' } as Req) as number;
  const rows = (yield { kind: 'number', prompt: '行数（縦）', default: 3, unit: 'raw' } as Req) as number;
  const dx = (yield N('列間隔 (mm)', mmToUm(20))) as number;
  const dy = (yield N('行間隔 (mm)', mmToUm(20))) as number;
  const created = arrayRect(app.doc, ents, Math.round(cols), Math.round(rows), dx, dy);
  app.store.tx('矩形状配列複写', () => { for (const e of created) app.store.add(e); });
}

function* cmdArrayPolar(app: App): Generator<Req, void, any> {
  const ents = (yield ES('配列複写する図形を選択')) as Entity[];
  if (!ents?.length) return;
  const c = (yield P('配列の中心')) as Pt;
  if (!c) return;
  const n = (yield { kind: 'number', prompt: '個数', default: 6, unit: 'raw' } as Req) as number;
  const total = (yield A('全体角度 (度)', degToUDeg(360))) as number;
  const created = arrayPolar(app.doc, ents, c, Math.max(2, Math.round(n)), total, true);
  app.store.tx('円形状配列複写', () => { for (const e of created) app.store.add(e); });
}

function* cmdStretch(app: App): Generator<Req, void, any> {
  const ents = (yield ES('ストレッチする図形を選択（交差選択で端点だけ動きます）')) as Entity[];
  if (!ents?.length) return;
  const base = (yield P('基点を指定')) as Pt;
  if (!base) return;
  const to = (yield P('移動先を指定', base)) as Pt;
  if (!to) return;
  const dx = to.x - base.x, dy = to.y - base.y;
  // 選択枠の内側にある端点だけを動かす
  const bb = docBBox(app.doc, ents);
  app.store.tx('ストレッチ', () => {
    for (const e of ents) {
      if (e.type === 'line') {
        const inA = inside(bb, { x: e.x1, y: e.y1 }), inB = inside(bb, { x: e.x2, y: e.y2 });
        app.store.update({
          ...e,
          x1: inA ? e.x1 + dx : e.x1, y1: inA ? e.y1 + dy : e.y1,
          x2: inB ? e.x2 + dx : e.x2, y2: inB ? e.y2 + dy : e.y2, updated: Date.now(),
        });
      } else if (e.type === 'polyline') {
        app.store.update({
          ...e,
          verts: e.verts.map((v) => (inside(bb, v) ? { ...v, x: v.x + dx, y: v.y + dy } : v)),
          updated: Date.now(),
        });
      } else {
        app.store.update(transformEntity(app.doc, e, moveXf(dx, dy)));
      }
    }
  });
}
const inside = (b: { x1: number; y1: number; x2: number; y2: number }, p: Pt): boolean =>
  p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2;

// ============================================================ 寸法

function makeDim(
  app: App, kind: DimKind, p1: Pt, p2: Pt, p3: Pt, refs: string[], prefix = '', p4?: Pt,
  attach1?: { id: string; part: number } | null, attach2?: { id: string; part: number } | null,
): DimEnt {
  return {
    ...mkCommon(app.doc, { layer: app.doc.layers.some((l) => l.name === '寸法') ? '寸法' : app.doc.currentLayer }),
    type: 'dim', kind, p1, p2, p3, p4, refs, textOverride: null,
    tol: { mode: 'none' }, th: mmToUm(3.5), arrow: mmToUm(3.5), prefix,
    attach1: attach1 ?? null, attach2: attach2 ?? null,
  };
}

function* cmdDimLinear(app: App): Generator<Req, void, any> {
  const a = (yield P('寸法の1点目')) as Pt;
  if (!a) return;
  const at1 = app.attachmentFor(a);
  const b = (yield P('寸法の2点目', a)) as Pt;
  if (!b) return;
  const at2 = app.attachmentFor(b);
  const c = (yield P('寸法線の位置', b, (p, painter) => {
    const kind = pickLinearKind(a, b, p);
    previewEntity(app, painter, makeDim(app, kind, a, b, p, []));
  })) as Pt;
  if (!c) return;
  const kind = pickLinearKind(a, b, c);
  const refs = [at1?.id, at2?.id].filter((x): x is string => !!x);
  app.store.tx('寸法', () => { app.store.add(makeDim(app, kind, a, b, c, refs, '', undefined, at1, at2)); });
}

function pickLinearKind(a: Pt, b: Pt, c: Pt): DimKind {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  // 寸法線位置が上下方向なら水平寸法、左右なら垂直寸法
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const vertical = Math.abs(c.x - mid.x) > Math.abs(c.y - mid.y);
  if (dx < 1 && dy < 1) return 'linear-h';
  return vertical ? 'linear-v' : 'linear-h';
}

function* cmdDimAligned(app: App): Generator<Req, void, any> {
  const a = (yield P('寸法の1点目')) as Pt;
  const at1 = a ? app.attachmentFor(a) : null;
  const b = (yield P('寸法の2点目', a)) as Pt;
  const at2 = b ? app.attachmentFor(b) : null;
  if (!a || !b) return;
  const c = (yield P('寸法線の位置', b, (p, painter) => previewEntity(app, painter, makeDim(app, 'aligned', a, b, p, [])))) as Pt;
  if (!c) return;
  app.store.tx('平行寸法', () => {
    app.store.add(makeDim(app, 'aligned', a, b, c, [at1?.id, at2?.id].filter((x): x is string => !!x), '', undefined, at1, at2));
  });
}

function* cmdDimRadius(app: App): Generator<Req, void, any> {
  const sel = (yield E('円または円弧を選択', (e) => e.type === 'circle' || e.type === 'arc')) as { entity: CircleEnt | ArcEnt; point: Pt };
  if (!sel) return;
  const e = sel.entity;
  const c = { x: e.cx, y: e.cy };
  const on = onCircle(c, e.r, angleOf(c, sel.point));
  const pos = (yield P('寸法文字の位置', c, (p, painter) => previewEntity(app, painter, makeDim(app, 'radius', c, on, p, [e.id], 'R')))) as Pt;
  if (!pos) return;
  app.store.tx('半径寸法', () => { app.store.add(makeDim(app, 'radius', c, on, pos, [e.id], 'R')); });
}

function* cmdDimDiameter(app: App): Generator<Req, void, any> {
  const sel = (yield E('円または円弧を選択', (e) => e.type === 'circle' || e.type === 'arc')) as { entity: CircleEnt | ArcEnt; point: Pt };
  if (!sel) return;
  const e = sel.entity;
  const c = { x: e.cx, y: e.cy };
  const on = onCircle(c, e.r, angleOf(c, sel.point));
  const pos = (yield P('寸法文字の位置', c, (p, painter) => previewEntity(app, painter, makeDim(app, 'diameter', c, on, p, [e.id], 'φ')))) as Pt;
  if (!pos) return;
  app.store.tx('直径寸法', () => { app.store.add(makeDim(app, 'diameter', c, on, pos, [e.id], 'φ')); });
}

function* cmdDimAngular(app: App): Generator<Req, void, any> {
  const v = (yield P('角の頂点')) as Pt;
  const a = (yield P('1辺目の点', v)) as Pt;
  const b = (yield P('2辺目の点', v)) as Pt;
  if (!v || !a || !b) return;
  const pos = (yield P('寸法弧の位置', v, (p, painter) => previewEntity(app, painter, makeDim(app, 'angular', a, b, p, [], '', v)))) as Pt;
  if (!pos) return;
  app.store.tx('角度寸法', () => { app.store.add(makeDim(app, 'angular', a, b, pos, [], '', v)); });
}

function* cmdDimArcLen(app: App): Generator<Req, void, any> {
  const sel = (yield E('円弧を選択', (e) => e.type === 'arc')) as { entity: ArcEnt; point: Pt };
  if (!sel) return;
  const e = sel.entity;
  const c = { x: e.cx, y: e.cy };
  const p1 = onCircle(c, e.r, e.a1), p2 = onCircle(c, e.r, e.a2);
  const pos = (yield P('寸法弧の位置', c, (p, painter) => previewEntity(app, painter, makeDim(app, 'arclen', p1, p2, p, [e.id], '', c)))) as Pt;
  if (!pos) return;
  app.store.tx('弧長寸法', () => { app.store.add(makeDim(app, 'arclen', p1, p2, pos, [e.id], '', c)); });
}

// ============================================================ 拘束

function handleFromPick(sel: { entity: Entity; point: Pt }): Handle {
  const e = sel.entity;
  if (e.type === 'line') {
    const a = { x: e.x1, y: e.y1 }, b = { x: e.x2, y: e.y2 };
    const mid = { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
    const ds = [dist(sel.point, a), dist(sel.point, b), dist(sel.point, mid)];
    const k = ds.indexOf(Math.min(...ds));
    return { id: e.id, part: k };
  }
  if (e.type === 'circle' || e.type === 'arc') {
    const c = { x: e.cx, y: e.cy };
    if (dist(sel.point, c) < e.r / 2) return { id: e.id, part: 0 };
    return { id: e.id, part: 1 };
  }
  return { id: e.id, part: 0 };
}

function addConstraint(app: App, type: ConstraintType, handles: Handle[], value?: number, expr?: string): void {
  const c: Constraint = {
    id: `c${app.doc.constraints.length + 1}_${Date.now().toString(36)}`,
    type, handles, value, expr, enabled: true,
  };
  app.store.tx(`拘束：${type}`, () => {
    app.store.touchMeta();
    app.doc.constraints.push(c);
  });
  app.runSolver();
}

function makeGeoConstraintCmd(type: ConstraintType, label: string, count: number): Command {
  return function* (app: App): Generator<Req, void, any> {
    const handles: Handle[] = [];
    for (let i = 0; i < count; i++) {
      const sel = (yield E(`${label}：${i + 1}つ目の対象を選択`)) as { entity: Entity; point: Pt } | null;
      if (!sel) return;
      handles.push(handleFromPick(sel));
    }
    addConstraint(app, type, handles);
    app.setStatus(`${label}拘束を追加しました：${app.solverMsg}`);
  };
}

function makeDimConstraintCmd(type: ConstraintType, label: string, count: number, unit: 'mm' | 'deg'): Command {
  return function* (app: App): Generator<Req, void, any> {
    const handles: Handle[] = [];
    for (let i = 0; i < count; i++) {
      const sel = (yield E(`${label}：${count > 1 ? `${i + 1}つ目の` : ''}対象を選択`)) as { entity: Entity; point: Pt } | null;
      if (!sel) return;
      handles.push(handleFromPick(sel));
    }
    const cur = currentMeasure(app, type, handles);
    const txt2 = (yield T(`${label}の値（数値または式。例: 穴径*3）`, cur !== null ? (unit === 'deg' ? (cur / UDEG_PER_DEG).toFixed(3) : fmtMM(cur, 3)) : '')) as string;
    if (!txt2) return;
    const isExpr = /[A-Za-z々぀-ヿ㐀-鿿]/.test(txt2);
    const v = app.parseNumber(txt2, unit);
    if (v === null) { app.setStatus('値を解釈できませんでした'); return; }
    addConstraint(app, type, handles, v, isExpr ? txt2 : undefined);
    app.setStatus(`${label}拘束を追加しました：${app.solverMsg}`);
  };
}

function currentMeasure(app: App, type: ConstraintType, handles: Handle[]): number | null {
  const pts = handles.map((h) => {
    const e = app.store.get(h.id);
    if (!e) return null;
    if (e.type === 'line') return h.part === 0 ? { x: e.x1, y: e.y1 } : h.part === 1 ? { x: e.x2, y: e.y2 } : { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 };
    if (e.type === 'circle' || e.type === 'arc') return { x: e.cx, y: e.cy };
    if (e.type === 'point') return { x: e.x, y: e.y };
    return null;
  });
  const e0 = app.store.get(handles[0]?.id ?? '');
  if (type === 'radius' && e0 && (e0.type === 'circle' || e0.type === 'arc')) return e0.r;
  if (type === 'diameter' && e0 && (e0.type === 'circle' || e0.type === 'arc')) return e0.r * 2;
  if (pts[0] && pts[1]) {
    if (type === 'distance') return Math.round(dist(pts[0], pts[1]));
    if (type === 'distanceH') return Math.round(pts[1].x - pts[0].x);
    if (type === 'distanceV') return Math.round(pts[1].y - pts[0].y);
  }
  if (type === 'angle') {
    const l1 = app.store.get(handles[0].id), l2 = app.store.get(handles[1]?.id ?? '');
    if (l1?.type === 'line' && l2?.type === 'line') {
      const a1 = angleOf({ x: l1.x1, y: l1.y1 }, { x: l1.x2, y: l1.y2 });
      const a2 = angleOf({ x: l2.x1, y: l2.y1 }, { x: l2.x2, y: l2.y2 });
      return qAngle(a2 - a1);
    }
  }
  return null;
}

// ============================================================ ブロック・ハッチ

function* cmdBlockMake(app: App): Generator<Req, void, any> {
  const ents = (yield ES('ブロックにする図形を選択')) as Entity[];
  if (!ents?.length) return;
  const name = (yield T('ブロック名')) as string;
  if (!name) return;
  const base = (yield P('基点を指定')) as Pt;
  if (!base) return;
  app.store.tx('ブロック作成', () => {
    app.store.touchMeta();
    app.doc.blocks[name] = {
      name, baseX: base.x, baseY: base.y,
      entities: ents.map((e) => ({ ...e })), attrs: { name },
    };
    for (const e of ents) app.store.remove(e.id);
    app.store.add({
      ...mkCommon(app.doc), type: 'insert', block: name, x: base.x, y: base.y,
      sx: 1_000_000, sy: 1_000_000, rot: 0,
    });
  });
  app.selection.clear();
  app.setStatus(`ブロック「${name}」を作成しました`);
}

function* cmdBlockInsert(app: App): Generator<Req, void, any> {
  const names = Object.keys(app.doc.blocks);
  if (!names.length) { app.setStatus('ブロックがまだありません（Bコマンドで作成できます）'); return; }
  const name = (yield T(`挿入するブロック名（${names.join(' / ')}）`, names[0])) as string;
  if (!name || !app.doc.blocks[name]) { app.setStatus('そのブロックはありません'); return; }
  for (;;) {
    const p = (yield P('挿入位置（Enterで終了）', null, (p2, painter) => {
      const b = app.doc.blocks[name];
      for (const e of b.entities) {
        previewEntity(app, painter, transformEntity(app.doc, e, moveXf(p2.x - b.baseX, p2.y - b.baseY)));
      }
    })) as Pt | null;
    if (!p) return;
    app.store.tx('ブロック挿入', () => {
      app.store.add({
        ...mkCommon(app.doc), type: 'insert', block: name, x: p.x, y: p.y,
        sx: 1_000_000, sy: 1_000_000, rot: 0,
      });
    });
  }
}

function* cmdHatch(app: App): Generator<Req, void, any> {
  const ents = (yield ES('ハッチングする閉じた図形を選択')) as Entity[];
  if (!ents?.length) return;
  const spacing = (yield N('ハッチ間隔 (mm)', mmToUm(3))) as number;
  const angle = (yield A('ハッチ角度 (度)', degToUDeg(45))) as number;
  app.store.tx('ハッチング', () => {
    app.store.add({
      ...mkCommon(app.doc), type: 'hatch', boundary: ents.map((e) => e.id),
      pattern: 'ANSI31', angle, spacing,
    });
  });
}


// ============================================================ 直列・並列・座標寸法

function* cmdDimContinue(app: App): Generator<Req, void, any> {
  let a = (yield P('直列寸法：起点')) as Pt;
  if (!a) return;
  let b = (yield P('2点目', a)) as Pt;
  if (!b) return;
  const pos = (yield P('寸法線の位置', b, (p, painter) => previewEntity(app, painter, makeDim(app, pickLinearKind(a, b, p), a, b, p, [])))) as Pt;
  if (!pos) return;
  const kind = pickLinearKind(a, b, pos);
  app.store.tx('直列寸法', () => { app.store.add(makeDim(app, kind, a, b, pos, [])); });
  for (;;) {
    const next = (yield P('次の点（Enterで終了）', b, (p, painter) => previewEntity(app, painter, makeDim(app, kind, b, p, pos, [])))) as Pt | null;
    if (!next) return;
    const from = b, to = next;
    app.store.tx('直列寸法', () => { app.store.add(makeDim(app, kind, from, to, pos, [])); });
    a = b; b = next;
  }
}

function* cmdDimBaseline(app: App): Generator<Req, void, any> {
  const base = (yield P('並列寸法：共通の基準点')) as Pt;
  if (!base) return;
  const first = (yield P('2点目', base)) as Pt;
  if (!first) return;
  const pos = (yield P('1本目の寸法線の位置', first, (p, painter) => previewEntity(app, painter, makeDim(app, pickLinearKind(base, first, p), base, first, p, [])))) as Pt;
  if (!pos) return;
  const kind = pickLinearKind(base, first, pos);
  const step = mmToUm(8) * (app.doc.sheet.scaleDen / app.doc.sheet.scaleNum);
  let level = 0;
  const posAt = (n: number): Pt => (kind === 'linear-v'
    ? pt(pos.x + step * n * (pos.x >= base.x ? 1 : -1), pos.y)
    : pt(pos.x, pos.y + step * n * (pos.y >= base.y ? 1 : -1)));
  app.store.tx('並列寸法', () => { app.store.add(makeDim(app, kind, base, first, posAt(0), [])); });
  for (;;) {
    level++;
    const lv = level;
    const next = (yield P('次の点（Enterで終了）', base, (p, painter) => previewEntity(app, painter, makeDim(app, kind, base, p, posAt(lv), [])))) as Pt | null;
    if (!next) return;
    const to = next;
    app.store.tx('並列寸法', () => { app.store.add(makeDim(app, kind, base, to, posAt(lv), [])); });
  }
}

function* cmdDimOrdinate(app: App): Generator<Req, void, any> {
  const origin = (yield P('座標寸法：原点を指定')) as Pt;
  if (!origin) return;
  for (;;) {
    const p = (yield P('測定する点（Enterで終了）')) as Pt | null;
    if (!p) return;
    const lead = (yield P('引出線の端点', p, (q2, painter) => previewEntity(app, painter, makeDim(app, 'ordinate', p, origin, q2, [])))) as Pt | null;
    if (!lead) return;
    const from = p, at = lead;
    app.store.tx('座標寸法', () => { app.store.add(makeDim(app, 'ordinate', from, origin, at, [])); });
  }
}

// ============================================================ 注記（幾何公差・引出線・表面粗さ）

function* cmdGtol(app: App): Generator<Req, void, any> {
  const labels = Object.entries(GTOL_SYMBOLS).map(([k, v]) => `${v.label}`);
  const name = (yield T(`幾何特性（${labels.join(' / ')}）`, '位置度')) as string;
  if (!name) return;
  const found = (Object.entries(GTOL_SYMBOLS) as [GtolSymbol, { mark: string; label: string }][])
    .find(([, v]) => v.label === name.trim());
  if (!found) { app.setStatus('その幾何特性はありません'); return; }
  const tol = (yield T('公差値（例: 0.05 / φ0.1）', '0.05')) as string;
  const datums = (yield T('データム（例: A,B。なしは空欄）', 'A')) as string;
  const p = (yield P('記号枠の左下位置', null, (q2, painter) => previewEntity(app, painter, {
    ...mkCommon(app.doc), type: 'gtol', x: q2.x, y: q2.y, h: mmToUm(3.5),
    symbol: found[0], tolerance: tol, datums: splitDatums(datums), leader: null,
  }))) as Pt;
  if (!p) return;
  const lead = (yield { kind: 'point', prompt: '引出線の先端（不要ならEnter）', optional: true } as Req) as Pt | null;
  app.store.tx('幾何公差', () => {
    app.store.add({
      ...mkCommon(app.doc), type: 'gtol', x: p.x, y: p.y, h: mmToUm(3.5),
      symbol: found[0], tolerance: tol, datums: splitDatums(datums), leader: lead ?? null,
    });
  });
}
const splitDatums = (s: string): string[] => s.split(/[,、\s]+/).map((x) => x.trim()).filter(Boolean);

function* cmdLeader(app: App): Generator<Req, void, any> {
  const from = (yield P('引出線の先端（指し示す位置）')) as Pt;
  if (!from) return;
  const to = (yield P('文字の位置', from, (p, painter) => line(painter, from, p))) as Pt;
  if (!to) return;
  const text = (yield T('コメント')) as string;
  if (!text) return;
  app.store.tx('引出線', () => {
    app.store.add({
      ...mkCommon(app.doc), type: 'leader', from, to, text, h: mmToUm(3.5), arrow: mmToUm(3.5),
    });
  });
}

function* cmdSurf(app: App): Generator<Req, void, any> {
  const kind = (yield K('加工の指定', [
    { key: 'R', label: '除去加工する' }, { key: 'N', label: '除去加工しない' }, { key: 'A', label: '問わない' },
  ])) as string;
  const value = (yield T('粗さ（例: Ra1.6）', 'Ra1.6')) as string;
  const note = (yield T('加工方法など（不要ならEnter）', '')) as string;
  const p = (yield P('記号の位置', null, (q2, painter) => previewEntity(app, painter, {
    ...mkCommon(app.doc), type: 'surf', x: q2.x, y: q2.y, h: mmToUm(3.5),
    kind: kind === 'R' ? 'remove' : kind === 'N' ? 'noRemove' : 'none', value, note, rot: 0,
  }))) as Pt;
  if (!p) return;
  app.store.tx('表面粗さ記号', () => {
    app.store.add({
      ...mkCommon(app.doc), type: 'surf', x: p.x, y: p.y, h: mmToUm(3.5),
      kind: kind === 'R' ? 'remove' : kind === 'N' ? 'noRemove' : 'none', value, note, rot: 0,
    });
  });
}

// ============================================================ 補助

function previewEntity(app: App, painter: Painter, e: Entity): void {
  switch (e.type) {
    case 'line': case 'circle': case 'arc': case 'polyline': case 'ellipse': {
      painter.beginPath();
      for (const s of entSegs(app.doc, e)) {
        if (s.kind === 'line') { painter.moveTo(s.a); painter.lineTo(s.b); }
        else painter.arc(s.c, s.r, s.a1, s.a2);
      }
      painter.stroke(PREVIEW);
      break;
    }
    case 'text':
      painter.text({ p: { x: e.x, y: e.y }, text: e.text, h: e.h, rotUDeg: e.rot, halign: e.halign, valign: e.valign, color: PREVIEW.color, font: e.font });
      break;
    case 'dim': case 'gtol': case 'leader': case 'surf':
      drawEntity(app.doc, e, painter, {});
      break;
    default: break;
  }
}

// ============================================================ 登録

export function registerCommands(app: App): void {
  const defs: CommandDef[] = [
    { name: '線', alias: ['L', 'LINE'], hint: '2点を指定して線を引く', run: cmdLine, group: '作図', icon: '／' },
    { name: 'ポリライン', alias: ['PL', 'PLINE'], hint: '連続した線', run: cmdPolyline, group: '作図', icon: '⌐' },
    { name: '円', alias: ['C', 'CIRCLE'], hint: '中心-半径ほか4種', run: cmdCircle, group: '作図', icon: '○' },
    { name: '円弧', alias: ['A', 'ARC'], hint: '3点／中心-始点-終点', run: cmdArc, group: '作図', icon: '◜' },
    { name: '矩形', alias: ['REC', 'RECTANG'], hint: '対角2点', run: cmdRect, group: '作図', icon: '▭' },
    { name: '正多角形', alias: ['POL', 'POLYGON'], hint: '内接／外接', run: cmdPolygon, group: '作図', icon: '⬡' },
    { name: '楕円', alias: ['EL', 'ELLIPSE'], hint: '中心-長軸-短軸', run: cmdEllipse, group: '作図', icon: '⬭' },
    { name: '文字', alias: ['T', 'DT', 'TEXT'], hint: '文字を書く', run: cmdText, group: '作図', icon: 'A' },
    { name: '点', alias: ['PO', 'POINT'], hint: '点を打つ', run: cmdPoint, group: '作図', icon: '·' },

    { name: '移動', alias: ['M', 'MOVE'], hint: '基点→移動先', run: cmdMove, group: '編集', icon: '✥' },
    { name: '複写', alias: ['CO', 'CP', 'COPY'], hint: '連続複写', run: cmdCopy, group: '編集', icon: '⧉' },
    { name: '回転', alias: ['RO', 'ROTATE'], hint: '中心と角度', run: cmdRotate, group: '編集', icon: '↻' },
    { name: '拡大縮小', alias: ['SC', 'SCALE'], hint: '基点と倍率', run: cmdScale, group: '編集', icon: '⤢' },
    { name: '鏡像', alias: ['MI', 'MIRROR'], hint: '対称軸を指定', run: cmdMirror, group: '編集', icon: '⇄' },
    { name: 'オフセット', alias: ['O', 'OFFSET'], hint: '一定距離の平行図形', run: cmdOffset, group: '編集', icon: '⊂' },
    { name: 'トリム', alias: ['TR', 'TRIM'], hint: 'はみ出しを切る', run: cmdTrim, group: '編集', icon: '✂' },
    { name: '延長', alias: ['EX', 'EXTEND'], hint: '境界まで伸ばす', run: cmdExtend, group: '編集', icon: '⇥' },
    { name: 'フィレット', alias: ['F', 'FILLET'], hint: '角を丸める', run: cmdFillet, group: '編集', icon: '◝' },
    { name: '面取り', alias: ['CHA', 'CHAMFER'], hint: '角を斜めに落とす', run: cmdChamfer, group: '編集', icon: '◺' },
    { name: '分解', alias: ['X', 'EXPLODE'], hint: 'ポリライン・ブロックをばらす', run: cmdExplode, group: '編集', icon: '⁂' },
    { name: '結合', alias: ['J', 'JOIN'], hint: '端点が一致する線をまとめる', run: cmdJoin, group: '編集', icon: '⊶' },
    { name: '削除', alias: ['E', 'ERASE', 'DEL'], hint: '図形を消す', run: cmdErase, group: '編集', icon: '⌫' },
    { name: '矩形状配列複写', alias: ['AR', 'ARRAY'], hint: '縦横に等間隔で並べる', run: cmdArrayRect, group: '編集', icon: '▦' },
    { name: '円形状配列複写', alias: ['ARP', 'POLARARRAY'], hint: '円周上に等間隔で並べる', run: cmdArrayPolar, group: '編集', icon: '✳' },
    { name: 'ストレッチ', alias: ['S', 'STRETCH'], hint: '端点だけ動かす', run: cmdStretch, group: '編集', icon: '↔' },

    { name: '長さ寸法', alias: ['DLI', 'DIMLINEAR'], hint: '水平／垂直寸法', run: cmdDimLinear, group: '寸法', icon: '↤' },
    { name: '平行寸法', alias: ['DAL', 'DIMALIGNED'], hint: '斜めの寸法', run: cmdDimAligned, group: '寸法', icon: '⟋' },
    { name: '半径寸法', alias: ['DRA', 'DIMRADIUS'], hint: 'R寸法', run: cmdDimRadius, group: '寸法', icon: 'R' },
    { name: '直径寸法', alias: ['DDI', 'DIMDIAMETER'], hint: 'φ寸法', run: cmdDimDiameter, group: '寸法', icon: 'φ' },
    { name: '角度寸法', alias: ['DAN', 'DIMANGULAR'], hint: '2辺のなす角', run: cmdDimAngular, group: '寸法', icon: '∠' },
    { name: '弧長寸法', alias: ['DAR', 'DIMARC'], hint: '円弧の長さ', run: cmdDimArcLen, group: '寸法', icon: '⌒' },
    { name: '直列寸法', alias: ['DCO', 'DIMCONTINUE'], hint: '続けて寸法を並べる', run: cmdDimContinue, group: '寸法', icon: '⋯' },
    { name: '並列寸法', alias: ['DBA', 'DIMBASELINE'], hint: '同じ基準から並べる', run: cmdDimBaseline, group: '寸法', icon: '≡' },
    { name: '座標寸法', alias: ['DOR', 'DIMORDINATE'], hint: '原点からの座標', run: cmdDimOrdinate, group: '寸法', icon: '⌐' },
    { name: '幾何公差', alias: ['TOL', 'GTOL'], hint: 'GD&Tの記号枠', run: cmdGtol, group: '寸法', icon: '⌖' },
    { name: '引出線', alias: ['LE', 'LEADER'], hint: '引出線付きコメント', run: cmdLeader, group: '寸法', icon: '↗' },
    { name: '表面粗さ', alias: ['SURF'], hint: '表面性状の記号', run: cmdSurf, group: '寸法', icon: '√' },

    { name: '拘束：一致', alias: ['GCO'], hint: '2点をくっつける', run: makeGeoConstraintCmd('coincident', '一致', 2), group: '拘束' },
    { name: '拘束：水平', alias: ['GHO'], hint: '線を真横に', run: makeGeoConstraintCmd('horizontal', '水平', 1), group: '拘束' },
    { name: '拘束：垂直', alias: ['GVE'], hint: '線を真縦に', run: makeGeoConstraintCmd('vertical', '垂直', 1), group: '拘束' },
    { name: '拘束：平行', alias: ['GPA'], hint: '2線を平行に', run: makeGeoConstraintCmd('parallel', '平行', 2), group: '拘束' },
    { name: '拘束：直角', alias: ['GPE'], hint: '2線を直角に', run: makeGeoConstraintCmd('perpendicular', '直角', 2), group: '拘束' },
    { name: '拘束：接線', alias: ['GTA'], hint: '線と円を接する', run: makeGeoConstraintCmd('tangent', '接線', 2), group: '拘束' },
    { name: '拘束：同心', alias: ['GCC'], hint: '2円の中心を揃える', run: makeGeoConstraintCmd('concentric', '同心', 2), group: '拘束' },
    { name: '拘束：等しい', alias: ['GEQ'], hint: '長さ・半径を同じに', run: makeGeoConstraintCmd('equal', '等しい', 2), group: '拘束' },
    { name: '拘束：対称', alias: ['GSY'], hint: '軸をはさんで左右対称', run: makeGeoConstraintCmd('symmetric', '対称', 3), group: '拘束' },
    { name: '拘束：固定', alias: ['GFI'], hint: '動かないように留める', run: makeGeoConstraintCmd('fixed', '固定', 1), group: '拘束' },
    { name: '寸法拘束：距離', alias: ['DCD'], hint: '2点間の距離を固定', run: makeDimConstraintCmd('distance', '距離', 2, 'mm'), group: '拘束' },
    { name: '寸法拘束：水平距離', alias: ['DCH'], hint: '水平方向の距離', run: makeDimConstraintCmd('distanceH', '水平距離', 2, 'mm'), group: '拘束' },
    { name: '寸法拘束：垂直距離', alias: ['DCV'], hint: '垂直方向の距離', run: makeDimConstraintCmd('distanceV', '垂直距離', 2, 'mm'), group: '拘束' },
    { name: '寸法拘束：半径', alias: ['DCR'], hint: '半径を固定', run: makeDimConstraintCmd('radius', '半径', 1, 'mm'), group: '拘束' },
    { name: '寸法拘束：直径', alias: ['DCI'], hint: '直径を固定', run: makeDimConstraintCmd('diameter', '直径', 1, 'mm'), group: '拘束' },
    { name: '寸法拘束：角度', alias: ['DCA'], hint: '2線のなす角を固定', run: makeDimConstraintCmd('angle', '角度', 2, 'deg'), group: '拘束' },

    { name: 'ブロック作成', alias: ['B', 'BLOCK'], hint: '部品として登録', run: cmdBlockMake, group: 'その他', icon: '▣' },
    { name: 'ブロック挿入', alias: ['I', 'INSERT'], hint: '登録した部品を貼る', run: cmdBlockInsert, group: 'その他', icon: '⊞' },
    { name: 'ハッチング', alias: ['H', 'HATCH'], hint: '断面の斜線', run: cmdHatch, group: 'その他', icon: '░' },
  ];
  for (const d of defs) app.register(d);
}

