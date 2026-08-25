/**
 * 注記記号の作図（仕様 6-2 幾何公差【必須】 / 6-3 注記記号【推奨】）
 * 寸法と同じく「線・文字・矢印」のプリミティブを返し、
 * 画面・PDF・SVG・DXF のすべてで同じ見た目になるようにする。
 */
import type { CadDocument, GtolEnt, LeaderEnt, SurfEnt, GtolSymbol } from '../model/types.js';
import type { DimGeom } from './dim.js';
import { type Pt, pt, angleOf, polar, dist } from '../core/geom.js';
import { UDEG_PER_DEG, qAngle } from '../core/units.js';

/** JIS B 0021 の幾何特性記号 */
export const GTOL_SYMBOLS: Record<GtolSymbol, { mark: string; label: string }> = {
  straight: { mark: '—', label: '真直度' },
  flat: { mark: '⏥', label: '平面度' },
  round: { mark: '○', label: '真円度' },
  cylindrical: { mark: '⌭', label: '円筒度' },
  lineProfile: { mark: '⌒', label: '線の輪郭度' },
  surfProfile: { mark: '⌓', label: '面の輪郭度' },
  parallel: { mark: '∥', label: '平行度' },
  perpendicular: { mark: '⊥', label: '直角度' },
  angular: { mark: '∠', label: '傾斜度' },
  position: { mark: '⌖', label: '位置度' },
  concentric: { mark: '◎', label: '同軸度' },
  symmetric: { mark: '⌯', label: '対称度' },
  runout: { mark: '↗', label: '円周振れ' },
  totalRunout: { mark: '⇗', label: '全振れ' },
};

const empty = (): DimGeom => ({ lines: [], arrows: [], texts: [], arcs: [], measured: 0 });

/** 文字幅の概算（記号枠のマス目を決めるのに使う） */
function textWidth(s: string, h: number): number {
  let w = 0;
  for (const ch of s) w += /[\x20-\x7e]/.test(ch) ? h * 0.6 : h * 1.0;
  return w;
}

/** 幾何公差の記号枠を作る */
export function gtolGeometry(e: GtolEnt): DimGeom {
  const g = empty();
  const h = e.h;
  const pad = h * 0.45;
  const boxH = h * 1.8;
  const cells: string[] = [GTOL_SYMBOLS[e.symbol].mark, e.tolerance, ...e.datums];
  let x = e.x;
  const y = e.y;
  const rect = (x1: number, y1: number, x2: number, y2: number): void => {
    g.lines.push({ a: pt(x1, y1), b: pt(x2, y1) });
    g.lines.push({ a: pt(x2, y1), b: pt(x2, y2) });
    g.lines.push({ a: pt(x2, y2), b: pt(x1, y2) });
    g.lines.push({ a: pt(x1, y2), b: pt(x1, y1) });
  };
  for (const c of cells) {
    const w = Math.max(boxH * 0.9, textWidth(c, h) + pad * 2);
    rect(x, y, x + w, y + boxH);
    g.texts.push({
      p: pt(x + w / 2, y + boxH / 2), text: c, h, rotUDeg: 0,
      halign: 'center', valign: 'middle',
    });
    x += w;
  }
  if (e.leader) {
    const start = pt(e.x, y + boxH / 2);
    g.lines.push({ a: start, b: e.leader });
    g.arrows.push({ p: e.leader, angleUDeg: angleOf(e.leader, start), size: h });
  }
  return g;
}

/** 引出線付きコメント */
export function leaderGeometry(e: LeaderEnt): DimGeom {
  const g = empty();
  const dirRight = e.to.x >= e.from.x;
  const shelf = polar(e.to, dirRight ? 0 : 180 * UDEG_PER_DEG, Math.max(e.h * 2, e.h * e.text.length * 0.5));
  g.lines.push({ a: e.from, b: e.to });
  g.lines.push({ a: e.to, b: shelf });
  g.arrows.push({ p: e.from, angleUDeg: angleOf(e.from, e.to), size: e.arrow });
  g.texts.push({
    p: pt((e.to.x + shelf.x) / 2, e.to.y + e.h * 0.3), text: e.text, h: e.h, rotUDeg: 0,
    halign: 'center', valign: 'bottom',
  });
  return g;
}

/** 表面性状（表面粗さ）記号 */
export function surfGeometry(e: SurfEnt): DimGeom {
  const g = empty();
  const h = e.h;
  const base = pt(e.x, e.y);
  const rot = e.rot;
  const P = (dx: number, dy: number): Pt => {
    const r = (rot / UDEG_PER_DEG) * Math.PI / 180;
    return pt(base.x + dx * Math.cos(r) - dy * Math.sin(r), base.y + dx * Math.sin(r) + dy * Math.cos(r));
  };
  // 60度のV字（左短辺・右長辺）
  const a = P(-h * 0.87, h * 1.5);
  const b = P(0, 0);
  const c = P(h * 1.73, h * 3);
  g.lines.push({ a, b }, { a: b, b: c });
  if (e.kind === 'remove') {
    // 横棒（除去加工する）
    g.lines.push({ a: P(-h * 0.87, h * 1.5), b: P(h * 0.87, h * 1.5) });
  } else if (e.kind === 'noRemove') {
    // 円（除去加工しない）
    g.arcs.push({ c: P(h * 0.43, h * 0.75), r: h * 0.87, a1: 0, a2: 360 * UDEG_PER_DEG });
  }
  if (e.value) g.texts.push({ p: P(h * 2.1, h * 3.2), text: e.value, h, rotUDeg: rot, halign: 'left', valign: 'bottom' });
  if (e.note) g.texts.push({ p: P(h * 2.1, h * 1.4), text: e.note, h: h * 0.8, rotUDeg: rot, halign: 'left', valign: 'bottom' });
  // 長辺の先の水平線
  g.lines.push({ a: c, b: P(h * 1.73 + Math.max(h * 4, textWidth(e.value, h) + h), h * 3) });
  void dist; void qAngle;
  return g;
}

export function annotGeometry(doc: CadDocument, e: GtolEnt | LeaderEnt | SurfEnt): DimGeom {
  void doc;
  if (e.type === 'gtol') return gtolGeometry(e);
  if (e.type === 'leader') return leaderGeometry(e);
  return surfGeometry(e);
}
