/**
 * 寸法の見た目を作る（仕様 第6章 / JIS B 0001 準拠）。
 * 画面描画・PDF・SVG・DXF出力で共通に使うため、
 * ここでは「線・矢印・文字」という描画プリミティブの列を返す。
 */
import type { CadDocument, DimEnt, Tolerance } from '../model/types.js';
import { type Pt, pt, dist, angleOf, polar, onCircle, sweepCCW, angleDiff } from '../core/geom.js';
import { fmtMM, UDEG_PER_DEG, qAngle, uDegToRad } from '../core/units.js';

export interface DimLine { a: Pt; b: Pt }
export interface DimArrow { p: Pt; angleUDeg: number; size: number }
export interface DimText {
  p: Pt; text: string; h: number; rotUDeg: number;
  halign: 'left' | 'center' | 'right'; valign: 'base' | 'middle' | 'bottom' | 'top';
}
export interface DimArcPart { c: Pt; r: number; a1: number; a2: number }

export interface DimGeom {
  lines: DimLine[];
  arrows: DimArrow[];
  texts: DimText[];
  arcs: DimArcPart[];
  /** 測定値（µm、角度寸法は µdeg） */
  measured: number;
}

/** 寸法値の文字列（mm、末尾の不要な0を落とす。JISの図面表記に合わせる） */
export function fmtDimValue(um: number): string {
  const s = fmtMM(um, 3);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** 公差込みの寸法文字を作る */
export function dimText(d: DimEnt, measured: number): { main: string; upper?: string; lower?: string } {
  const base = d.textOverride ?? `${d.prefix}${d.kind === 'angular'
    ? `${Number((measured / UDEG_PER_DEG).toFixed(3))}°`
    : fmtDimValue(measured)}`;
  const t: Tolerance = d.tol ?? { mode: 'none' };
  switch (t.mode) {
    case 'sym': return { main: `${base} ±${fmtDimValue(t.sym ?? 0)}` };
    case 'dev': return {
      main: base,
      upper: `${(t.upper ?? 0) >= 0 ? '+' : '-'}${fmtDimValue(Math.abs(t.upper ?? 0))}`,
      lower: `${(t.lower ?? 0) >= 0 ? '+' : '-'}${fmtDimValue(Math.abs(t.lower ?? 0))}`,
    };
    case 'fit': return { main: `${base} ${t.fit ?? ''}`.trim() };
    case 'basic': return { main: `[${base}]` };
    default: return { main: base };
  }
}

const EXT_GAP = 1000;    // 図形から寸法補助線までの隙間 1mm
const EXT_OVER = 2000;   // 寸法線を超えて伸ばす量 2mm
const TEXT_GAP = 800;    // 寸法線と文字の隙間 0.8mm

/** 寸法図形の描画プリミティブを生成する */
export function dimGeometry(doc: CadDocument, d: DimEnt): DimGeom {
  const g: DimGeom = { lines: [], arrows: [], texts: [], arcs: [], measured: 0 };
  const arrow = d.arrow || 3500;
  const th = d.th || 3500;

  switch (d.kind) {
    case 'linear-h': case 'linear-v': case 'aligned': {
      // 寸法線の方向
      let dirU: number;
      if (d.kind === 'linear-h') dirU = 0;
      else if (d.kind === 'linear-v') dirU = 90 * UDEG_PER_DEG;
      else dirU = angleOf(d.p1, d.p2);
      const rad = uDegToRad(dirU);
      const ux = Math.cos(rad), uy = Math.sin(rad);
      // 寸法線は p3 を通り、方向 dirU の直線。各計測点から垂線で落とす。
      const proj = (p: Pt): Pt => {
        const t = (p.x - d.p3.x) * ux + (p.y - d.p3.y) * uy;
        return pt(d.p3.x + ux * t, d.p3.y + uy * t);
      };
      const a = proj(d.p1), b = proj(d.p2);
      const measured = Math.round(dist(a, b));
      g.measured = measured;
      // 寸法補助線
      for (const [src, dst] of [[d.p1, a], [d.p2, b]] as [Pt, Pt][]) {
        const L = dist(src, dst);
        if (L > EXT_GAP) {
          const dirE = angleOf(src, dst);
          g.lines.push({ a: polar(src, dirE, EXT_GAP), b: polar(dst, dirE, EXT_OVER) });
        } else {
          g.lines.push({ a: src, b: polar(dst, angleOf(src, dst) || dirU + 90 * UDEG_PER_DEG, EXT_OVER) });
        }
      }
      // 寸法線と矢印
      const short = dist(a, b) < arrow * 3;
      if (short) {
        // 矢印を外向きに（JIS: 寸法が小さいとき）
        g.lines.push({ a: polar(a, angleOf(b, a), arrow * 2), b: polar(b, angleOf(a, b), arrow * 2) });
        g.arrows.push({ p: a, angleUDeg: angleOf(b, a), size: arrow });
        g.arrows.push({ p: b, angleUDeg: angleOf(a, b), size: arrow });
      } else {
        g.lines.push({ a, b });
        g.arrows.push({ p: a, angleUDeg: angleOf(a, b), size: arrow });
        g.arrows.push({ p: b, angleUDeg: angleOf(b, a), size: arrow });
      }
      // 文字（寸法線の上、線に沿った向き。上下逆さにならないよう補正）
      const mid = pt((a.x + b.x) / 2, (a.y + b.y) / 2);
      let trot = dirU;
      if (angleDiff(trot, 0) > 90 * UDEG_PER_DEG || angleDiff(trot, 0) <= -90 * UDEG_PER_DEG) trot = qAngle(trot + 180 * UDEG_PER_DEG);
      const up = qAngle(trot + 90 * UDEG_PER_DEG);
      const t = dimText(d, measured);
      const tp = polar(mid, up, TEXT_GAP);
      g.texts.push({ p: tp, text: t.main, h: th, rotUDeg: trot, halign: 'center', valign: 'bottom' });
      if (t.upper !== undefined) {
        const rp = polar(tp, trot, (t.main.length * th * 0.6) / 2 + th * 0.3);
        g.texts.push({ p: polar(rp, up, th * 0.55), text: t.upper, h: th * 0.6, rotUDeg: trot, halign: 'left', valign: 'bottom' });
        g.texts.push({ p: polar(rp, up, -th * 0.05), text: t.lower ?? '', h: th * 0.6, rotUDeg: trot, halign: 'left', valign: 'bottom' });
      }
      break;
    }

    case 'radius': case 'diameter': {
      const c = d.p1;
      const r = Math.round(dist(d.p1, d.p2));
      const dirU = angleOf(c, d.p3);
      g.measured = d.kind === 'diameter' ? r * 2 : r;
      const onArc = polar(c, dirU, r);
      if (d.kind === 'diameter') {
        const opp = polar(c, qAngle(dirU + 180 * UDEG_PER_DEG), r);
        g.lines.push({ a: opp, b: d.p3 });
        g.arrows.push({ p: onArc, angleUDeg: qAngle(dirU + 180 * UDEG_PER_DEG), size: arrow });
        g.arrows.push({ p: opp, angleUDeg: dirU, size: arrow });
      } else {
        g.lines.push({ a: c, b: d.p3 });
        g.arrows.push({ p: onArc, angleUDeg: qAngle(dirU + 180 * UDEG_PER_DEG), size: arrow });
      }
      const t = dimText(d, g.measured);
      const outside = dist(c, d.p3) > r;
      const tp = outside ? polar(d.p3, dirU, TEXT_GAP) : polar(d.p3, qAngle(dirU + 90 * UDEG_PER_DEG), TEXT_GAP);
      let trot = dirU;
      if (angleDiff(trot, 0) > 90 * UDEG_PER_DEG || angleDiff(trot, 0) <= -90 * UDEG_PER_DEG) trot = qAngle(trot + 180 * UDEG_PER_DEG);
      g.texts.push({
        p: tp, text: t.main, h: th, rotUDeg: trot,
        halign: outside ? (Math.cos(uDegToRad(dirU)) >= 0 ? 'left' : 'right') : 'center',
        valign: outside ? 'middle' : 'bottom',
      });
      break;
    }

    case 'angular': {
      const v = d.p4 ?? d.p1;
      const a1 = angleOf(v, d.p1), a2 = angleOf(v, d.p2);
      const r = Math.round(dist(v, d.p3));
      const sweep = sweepCCW(a1, a2);
      g.measured = sweep > 180 * UDEG_PER_DEG ? 360 * UDEG_PER_DEG - sweep : sweep;
      const [s1, s2] = sweep > 180 * UDEG_PER_DEG ? [a2, a1] : [a1, a2];
      g.arcs.push({ c: v, r, a1: s1, a2: s2 });
      // 寸法補助線
      for (const [p, a] of [[d.p1, s1], [d.p2, s2]] as [Pt, number][]) {
        const dd = dist(v, p);
        if (dd < r) g.lines.push({ a: p, b: polar(v, a, r + EXT_OVER) });
      }
      const e1 = onCircle(v, r, s1), e2 = onCircle(v, r, s2);
      g.arrows.push({ p: e1, angleUDeg: qAngle(s1 + 90 * UDEG_PER_DEG), size: arrow });
      g.arrows.push({ p: e2, angleUDeg: qAngle(s2 - 90 * UDEG_PER_DEG), size: arrow });
      const midA = qAngle(s1 + sweepCCW(s1, s2) / 2);
      const t = dimText(d, g.measured);
      g.texts.push({ p: polar(v, midA, r + TEXT_GAP + th * 0.5), text: t.main, h: th, rotUDeg: 0, halign: 'center', valign: 'middle' });
      break;
    }

    case 'arclen': {
      const v = d.p4 ?? d.p1;
      const a1 = angleOf(v, d.p1), a2 = angleOf(v, d.p2);
      const r = Math.round(dist(v, d.p1));
      const rr = Math.round(dist(v, d.p3));
      const sweep = sweepCCW(a1, a2);
      g.measured = Math.round((r * uDegToRad(sweep)));
      g.arcs.push({ c: v, r: rr, a1, a2 });
      g.arrows.push({ p: onCircle(v, rr, a1), angleUDeg: qAngle(a1 + 90 * UDEG_PER_DEG), size: arrow });
      g.arrows.push({ p: onCircle(v, rr, a2), angleUDeg: qAngle(a2 - 90 * UDEG_PER_DEG), size: arrow });
      const midA = qAngle(a1 + sweep / 2);
      const t = dimText(d, g.measured);
      g.texts.push({ p: polar(v, midA, rr + TEXT_GAP + th * 0.6), text: `⌒${t.main}`, h: th, rotUDeg: 0, halign: 'center', valign: 'middle' });
      break;
    }

    case 'ordinate': {
      // 座標寸法：原点からの距離を引出線で示す
      const horiz = Math.abs(d.p3.x - d.p1.x) < Math.abs(d.p3.y - d.p1.y);
      g.measured = horiz ? Math.abs(d.p1.x - d.p2.x) : Math.abs(d.p1.y - d.p2.y);
      g.lines.push({ a: d.p1, b: d.p3 });
      const t = dimText(d, g.measured);
      g.texts.push({
        p: polar(d.p3, horiz ? 90 * UDEG_PER_DEG : 0, TEXT_GAP), text: t.main, h: th,
        rotUDeg: horiz ? 90 * UDEG_PER_DEG : 0, halign: 'left', valign: 'middle',
      });
      break;
    }
  }
  void doc;
  return g;
}
