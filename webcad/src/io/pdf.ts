/**
 * PDF 出力（仕様 7-3）。ベクター形式・尺度1:1保証。
 * 依存ライブラリなしで PDF 1.4 を直接生成する。
 *
 * 文字：ASCII は Helvetica（標準14書体）。日本語を含む文字列は
 *       Adobe-Japan1 の標準CMap(UniJIS-UCS2-H)を使う非埋め込みフォント指定。
 *       ※日本語の見た目を完全に固定したい場合は「印刷 → PDFとして保存」を使う。
 */
import type { CadDocument, Entity } from '../model/types.js';
import type { Painter, StrokeStyle, TextDraw } from '../render/painter.js';
import { DASH_PATTERNS, drawEntity } from '../render/painter.js';
import type { Pt, BBox } from '../core/geom.js';
import { UM_PER_MM, uDegToRad } from '../core/units.js';
import { hexToRgb } from './aci.js';

const MM_TO_PT = 72 / 25.4;

class PdfPainter implements Painter {
  ops: string[] = [];
  usedCjk = false;
  private lastColor = '';

  constructor(private toX: (um: number) => number, private toY: (um: number) => number, private sc: number) {}

  private n(v: number): string { return (Math.round(v * 1000) / 1000).toString(); }

  beginPath(): void { /* パスはストローク時にまとめて出す */ }
  moveTo(p: Pt): void { this.ops.push(`${this.n(this.toX(p.x))} ${this.n(this.toY(p.y))} m`); }
  lineTo(p: Pt): void { this.ops.push(`${this.n(this.toX(p.x))} ${this.n(this.toY(p.y))} l`); }
  closePath(): void { this.ops.push('h'); }

  arc(c: Pt, r: number, a1: number, a2: number): void {
    const sweep = ((a2 - a1) / 1e6 + 360) % 360 || 360;
    const steps = Math.max(1, Math.ceil(sweep / 90));
    const k = (4 / 3) * Math.tan((sweep / steps) * Math.PI / 180 / 4);
    let a = a1 / 1e6;
    const P = (deg: number): { x: number; y: number } => ({
      x: this.toX(c.x + r * Math.cos((deg * Math.PI) / 180)),
      y: this.toY(c.y + r * Math.sin((deg * Math.PI) / 180)),
    });
    // PDF は図面と同じ y 上向き座標系なので、接線は素直に求まる
    const T = (deg: number): { x: number; y: number } => {
      const rad = (deg * Math.PI) / 180;
      const rp = (r / UM_PER_MM) * this.sc * MM_TO_PT;
      return { x: -rp * Math.sin(rad), y: rp * Math.cos(rad) };
    };
    let p0 = P(a);
    this.ops.push(`${this.n(p0.x)} ${this.n(p0.y)} m`);
    for (let i = 0; i < steps; i++) {
      const a3 = a + sweep / steps;
      const p1 = P(a3);
      const t0 = T(a), t1 = T(a3);
      const c1 = { x: p0.x + k * t0.x, y: p0.y + k * t0.y };
      const c2 = { x: p1.x - k * t1.x, y: p1.y - k * t1.y };
      this.ops.push(`${this.n(c1.x)} ${this.n(c1.y)} ${this.n(c2.x)} ${this.n(c2.y)} ${this.n(p1.x)} ${this.n(p1.y)} c`);
      p0 = p1; a = a3;
    }
  }

  stroke(s: StrokeStyle): void {
    const [r, g, b] = hexToRgb(s.color);
    const col = `${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} RG`;
    if (col !== this.lastColor) { this.ops.push(col); this.lastColor = col; }
    const lwPt = (s.lwUm / UM_PER_MM) * (s.dashScale / 1000) * this.sc * MM_TO_PT;
    this.ops.push(`${this.n(Math.max(0.05, lwPt))} w`);
    const pat = DASH_PATTERNS[s.linetype];
    this.ops.push(pat.length
      ? `[${pat.map((v) => this.n(v * (s.dashScale / 1000) * this.sc * MM_TO_PT)).join(' ')}] 0 d`
      : '[] 0 d');
    this.ops.push('S');
  }

  fillPath(color: string): void {
    const [r, g, b] = hexToRgb(color);
    this.ops.push(`${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} rg`);
    this.ops.push('f');
  }

  text(t: TextDraw): void {
    const cjk = /[^\x20-\x7e]/.test(t.text);
    if (cjk) this.usedCjk = true;
    const size = (t.h / UM_PER_MM) * this.sc * MM_TO_PT;
    const x = this.toX(t.p.x), y = this.toY(t.p.y);
    const w = estimateWidth(t.text, size);
    let dx = 0, dy = 0;
    if (t.halign === 'center') dx = -w / 2;
    else if (t.halign === 'right') dx = -w;
    if (t.valign === 'middle') dy = -size * 0.36;
    else if (t.valign === 'top') dy = -size * 0.72;
    const rad = uDegToRad(t.rotUDeg);
    const cs = Math.cos(rad), sn = Math.sin(rad);
    const [r, g, b] = hexToRgb(t.color);
    // 文字ローカルのずらし量(dx,dy)を同じ角度で回してから加える
    const tx = x + dx * cs - dy * sn;
    const ty = y + dx * sn + dy * cs;
    this.ops.push('BT');
    this.ops.push(`${(r / 255).toFixed(3)} ${(g / 255).toFixed(3)} ${(b / 255).toFixed(3)} rg`);
    this.ops.push(`/${cjk ? 'F2' : 'F1'} ${this.n(size)} Tf`);
    this.ops.push(`${this.n(cs)} ${this.n(sn)} ${this.n(-sn)} ${this.n(cs)} ${this.n(tx)} ${this.n(ty)} Tm`);
    this.ops.push(cjk ? `<${utf16be(t.text)}> Tj` : `(${escapePdf(t.text)}) Tj`);
    this.ops.push('ET');
  }
}

function estimateWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += /[^\x20-\x7e]/.test(ch) ? size : size * 0.55;
  return w;
}
function escapePdf(s: string): string {
  return s.replace(/([\\()])/g, '\\$1');
}
function utf16be(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) out += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
  return out;
}

export const PAPER_MM: Record<string, [number, number]> = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297],
};

export interface PdfOptions {
  /** 図面上の出力範囲（通常は用紙枠） */
  bbox: BBox;
  paper: keyof typeof PAPER_MM;
  landscape: boolean;
  scaleDen: number;
  extra?: Entity[];
  monochrome?: boolean;
  title?: string;
}

export function writePdf(doc: CadDocument, o: PdfOptions): Blob {
  const [ph, pw] = PAPER_MM[o.paper] ?? PAPER_MM.A3;
  const wMm = o.landscape ? pw : ph;
  const hMm = o.landscape ? ph : pw;
  const wPt = wMm * MM_TO_PT, hPt = hMm * MM_TO_PT;
  const sc = 1 / o.scaleDen;

  // 図面範囲を用紙中央に配置
  const drawWmm = ((o.bbox.x2 - o.bbox.x1) / UM_PER_MM) * sc;
  const drawHmm = ((o.bbox.y2 - o.bbox.y1) / UM_PER_MM) * sc;
  const offX = (wMm - drawWmm) / 2;
  const offY = (hMm - drawHmm) / 2;

  const toX = (um: number): number => (offX + ((um - o.bbox.x1) / UM_PER_MM) * sc) * MM_TO_PT;
  const toY = (um: number): number => (offY + ((um - o.bbox.y1) / UM_PER_MM) * sc) * MM_TO_PT;

  const p = new PdfPainter(toX, toY, sc);
  const opt = {
    scaleDen: o.scaleDen,
    printableOnly: true,
    overrideColor: o.monochrome ? (): string => '#000000' : undefined,
  };
  for (const e of o.extra ?? []) drawEntity(doc, e, p, opt);
  for (const e of doc.entities) drawEntity(doc, e, p, opt);

  const content = ['1 J 1 j', ...p.ops].join('\n');

  const objs: string[] = [];
  const push = (s: string): number => { objs.push(s); return objs.length; };

  const catalogId = 1, pagesId = 2, pageId = 3, contentId = 4, f1 = 5, f2 = 6, cidFont = 7, fdesc = 8;
  push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  push(`<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  push(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${wPt.toFixed(3)} ${hPt.toFixed(3)}] ` +
    `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`);
  push(`<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`);
  push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  push(`<< /Type /Font /Subtype /Type0 /BaseFont /Ryumin-Light /Encoding /UniJIS-UCS2-H /DescendantFonts [${cidFont} 0 R] >>`);
  push(`<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Ryumin-Light ` +
    `/CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 6 >> ` +
    `/FontDescriptor ${fdesc} 0 R /DW 1000 >>`);
  push('<< /Type /FontDescriptor /FontName /Ryumin-Light /Flags 6 /FontBBox [0 -137 1000 859] ' +
    '/ItalicAngle 0 /Ascent 859 /Descent -137 /CapHeight 709 /StemV 80 >>');
  void catalogId;

  let pdf = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info << /Title (${escapePdf(asciiOnly(o.title ?? doc.name))}) /Producer (WebCAD 2D) >> >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  return new Blob([toBytes(pdf).buffer as ArrayBuffer], { type: 'application/pdf' });
}

function asciiOnly(s: string): string { return s.replace(/[^\x20-\x7e]/g, '_'); }

/** PDF は Latin-1 バイト列として書き出す */
function toBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
function byteLength(s: string): number { return s.length; }
