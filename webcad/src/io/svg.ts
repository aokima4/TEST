/** SVG 出力（仕様 7-3）。用紙サイズ・尺度を反映し、mm 実寸で出力する。 */
import type { CadDocument, Entity } from '../model/types.js';
import type { Painter, StrokeStyle, TextDraw } from '../render/painter.js';
import { DASH_PATTERNS, drawEntity } from '../render/painter.js';
import type { Pt, BBox } from '../core/geom.js';
import { UM_PER_MM, uDegToRad } from '../core/units.js';

/** 図面座標(µm) → SVGユーザ単位(mm)。y軸を反転する。 */
class SvgPainter implements Painter {
  parts: string[] = [];
  private cur: string[] = [];

  constructor(private toX: (um: number) => number, private toY: (um: number) => number, private sc: number) {}

  private n(v: number): string { return (Math.round(v * 1e4) / 1e4).toString(); }

  beginPath(): void { this.cur = []; }
  moveTo(p: Pt): void { this.cur.push(`M${this.n(this.toX(p.x))} ${this.n(this.toY(p.y))}`); }
  lineTo(p: Pt): void { this.cur.push(`L${this.n(this.toX(p.x))} ${this.n(this.toY(p.y))}`); }
  closePath(): void { this.cur.push('Z'); }

  arc(c: Pt, r: number, a1: number, a2: number): void {
    const sweepDeg = ((a2 - a1) / 1e6 + 360) % 360 || 360;
    const steps = Math.max(1, Math.ceil(sweepDeg / 90));
    const start = { x: c.x + r * Math.cos(uDegToRad(a1)), y: c.y + r * Math.sin(uDegToRad(a1)) };
    this.cur.push(`M${this.n(this.toX(start.x))} ${this.n(this.toY(start.y))}`);
    const rr = this.n(r / UM_PER_MM * this.sc);
    for (let i = 1; i <= steps; i++) {
      const a = a1 + (sweepDeg * 1e6 * i) / steps;
      const p = { x: c.x + r * Math.cos(uDegToRad(a)), y: c.y + r * Math.sin(uDegToRad(a)) };
      // y反転しているため sweep-flag は 0（時計回り）
      this.cur.push(`A${rr} ${rr} 0 0 0 ${this.n(this.toX(p.x))} ${this.n(this.toY(p.y))}`);
    }
  }

  stroke(s: StrokeStyle): void {
    if (!this.cur.length) return;
    const pat = DASH_PATTERNS[s.linetype];
    const dash = pat.length ? ` stroke-dasharray="${pat.map((v) => (v * (s.dashScale / 1000) * this.sc).toFixed(3)).join(' ')}"` : '';
    const lw = (s.lwUm / UM_PER_MM) * (s.dashScale / 1000) * this.sc;
    this.parts.push(`<path d="${this.cur.join(' ')}" fill="none" stroke="${s.color}" stroke-width="${lw.toFixed(3)}"${dash} stroke-linecap="round" stroke-linejoin="round"/>`);
    this.cur = [];
  }

  fillPath(color: string): void {
    if (!this.cur.length) return;
    this.parts.push(`<path d="${this.cur.join(' ')} Z" fill="${color}" stroke="none"/>`);
    this.cur = [];
  }

  text(t: TextDraw): void {
    const x = this.toX(t.p.x), y = this.toY(t.p.y);
    const size = (t.h / UM_PER_MM) * this.sc;
    const anchor = t.halign === 'center' ? 'middle' : t.halign === 'right' ? 'end' : 'start';
    const baseline = t.valign === 'middle' ? 'central' : t.valign === 'top' ? 'hanging' : t.valign === 'bottom' ? 'alphabetic' : 'alphabetic';
    const dy = t.valign === 'bottom' ? 0 : 0;
    const rot = -t.rotUDeg / 1e6;
    const tr = rot !== 0 ? ` transform="rotate(${rot.toFixed(4)} ${x.toFixed(3)} ${y.toFixed(3)})"` : '';
    this.parts.push(
      `<text x="${x.toFixed(3)}" y="${(y + dy).toFixed(3)}" font-family="${escapeAttr(t.font || 'sans-serif')}" font-size="${size.toFixed(3)}" fill="${t.color}" text-anchor="${anchor}" dominant-baseline="${baseline}"${tr}>${escapeText(t.text)}</text>`,
    );
  }
}

const escapeText = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

export interface SvgOptions {
  /** 出力範囲（省略時は用紙全体） */
  bbox: BBox;
  /** 尺度の分母／分子（1:2 なら 2） */
  scaleDen: number;
  extra?: Entity[];
  background?: string | null;
  monochrome?: boolean;
}

export function writeSvg(doc: CadDocument, o: SvgOptions): string {
  const sc = 1 / o.scaleDen;                     // 図面mm → 紙面mm
  const wMm = ((o.bbox.x2 - o.bbox.x1) / UM_PER_MM) * sc;
  const hMm = ((o.bbox.y2 - o.bbox.y1) / UM_PER_MM) * sc;
  const toX = (um: number): number => ((um - o.bbox.x1) / UM_PER_MM) * sc;
  const toY = (um: number): number => hMm - ((um - o.bbox.y1) / UM_PER_MM) * sc;
  const p = new SvgPainter(toX, toY, sc);

  const opt = {
    scaleDen: o.scaleDen,
    printableOnly: true,
    overrideColor: o.monochrome ? (): string => '#000000' : undefined,
  };
  for (const e of o.extra ?? []) drawEntity(doc, e, p, opt);
  for (const e of doc.entities) drawEntity(doc, e, p, opt);

  const bg = o.background ? `<rect width="${wMm.toFixed(3)}" height="${hMm.toFixed(3)}" fill="${o.background}"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${wMm.toFixed(3)}mm" height="${hMm.toFixed(3)}mm" viewBox="0 0 ${wMm.toFixed(3)} ${hMm.toFixed(3)}">
<title>${escapeText(doc.name)}</title>
${bg}
${p.parts.join('\n')}
</svg>`;
}
