/** Canvas2D による画面描画 */
import type { Pt, BBox } from '../core/geom.js';
import type { CadDocument, Entity } from '../model/types.js';
import type { Painter, StrokeStyle, TextDraw, DrawOptions } from './painter.js';
import { DASH_PATTERNS, drawEntity } from './painter.js';
import type { Viewport } from '../view/viewport.js';
import { entBBox, SpatialIndex } from '../model/doc.js';
import { UM_PER_MM, uDegToRad, fmtMM } from '../core/units.js';

export class CanvasPainter implements Painter {
  constructor(
    private ctx: CanvasRenderingContext2D,
    private vp: Viewport,
    /** 線幅表示ON/OFF */
    public showLineweight = true,
  ) {}

  beginPath(): void { this.ctx.beginPath(); }
  moveTo(p: Pt): void { this.ctx.moveTo(this.vp.sx(p.x), this.vp.sy(p.y)); }
  lineTo(p: Pt): void { this.ctx.lineTo(this.vp.sx(p.x), this.vp.sy(p.y)); }
  closePath(): void { this.ctx.closePath(); }

  arc(c: Pt, r: number, a1: number, a2: number): void {
    const rp = r * this.vp.scale;
    if (rp < 0.4) { // 画面上で点にしかならない円は1点だけ打つ
      this.ctx.moveTo(this.vp.sx(c.x), this.vp.sy(c.y));
      this.ctx.lineTo(this.vp.sx(c.x) + 0.5, this.vp.sy(c.y));
      return;
    }
    // Canvasのy軸は下向きなので、角度を反転し時計回り指定にする
    this.ctx.arc(this.vp.sx(c.x), this.vp.sy(c.y), rp, -uDegToRad(a1), -uDegToRad(a2), true);
  }

  stroke(s: StrokeStyle): void {
    const ctx = this.ctx;
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = s.opacity ?? 1;
    const lwPx = this.showLineweight
      ? Math.max(1, (s.lwUm / UM_PER_MM) * (s.dashScale / 1000) * this.vp.pxPerMm)
      : 1;
    ctx.lineWidth = lwPx;
    const pat = DASH_PATTERNS[s.linetype];
    if (pat.length) {
      ctx.setLineDash(pat.map((mm) => Math.max(1, mm * (s.dashScale / 1000) * this.vp.pxPerMm)));
    } else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  fillPath(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fill();
  }

  text(t: TextDraw): void {
    const ctx = this.ctx;
    const hPx = t.h * this.vp.scale;
    if (hPx < 4) return;                 // 小さすぎる文字は省略（性能のため）
    ctx.save();
    ctx.translate(this.vp.sx(t.p.x), this.vp.sy(t.p.y));
    ctx.rotate(-uDegToRad(t.rotUDeg));
    ctx.fillStyle = t.color;
    ctx.font = `${hPx}px ${t.font || 'sans-serif'}`;
    ctx.textAlign = t.halign === 'center' ? 'center' : t.halign === 'right' ? 'right' : 'left';
    ctx.textBaseline =
      t.valign === 'middle' ? 'middle' : t.valign === 'top' ? 'top' : t.valign === 'bottom' ? 'bottom' : 'alphabetic';
    ctx.fillText(t.text, 0, 0);
    ctx.restore();
  }
}

export interface SceneOptions extends DrawOptions {
  grid: { on: boolean; spacingUm: number };
  showLineweight: boolean;
  selection: Set<string>;
  hover: string | null;
  dofColors: Map<string, 'under' | 'full' | 'over'> | null;
  showDof: boolean;
  /** 図面枠など、ドキュメント外の追加図形 */
  extra: Entity[];
  darkTheme: boolean;
}

export const THEME = {
  bg: '#14161a',
  bgLight: '#ffffff',
  grid: '#22262d',
  gridMajor: '#2d323b',
  axis: '#3c4450',
  select: '#ffd24a',
  hover: '#7fd1ff',
  dofUnder: '#4a9bff',
  dofFull: '#3ddc84',
  dofOver: '#ff4d4d',
  snap: '#38ff9a',
};

/** シーン全体を描く */
export function renderScene(
  ctx: CanvasRenderingContext2D, vp: Viewport, doc: CadDocument, index: SpatialIndex, o: SceneOptions,
): { drawn: number } {
  const w = vp.width, h = vp.height;
  ctx.save();
  ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);
  ctx.fillStyle = o.darkTheme ? THEME.bg : THEME.bgLight;
  ctx.fillRect(0, 0, w, h);

  if (o.grid.on) drawGrid(ctx, vp, o);

  const painter = new CanvasPainter(ctx, vp, o.showLineweight);
  const vis: BBox = vp.visibleBBox(80);
  const ids = index.query(vis);

  const opt: DrawOptions = {
    scaleDen: doc.sheet.scaleDen / doc.sheet.scaleNum,
    overrideColor: (e) => {
      if (o.selection.has(e.id)) return THEME.select;
      if (o.hover === e.id) return THEME.hover;
      if (o.showDof && o.dofColors) {
        const st = o.dofColors.get(e.id);
        if (st === 'over') return THEME.dofOver;
        if (st === 'full') return THEME.dofFull;
        if (st === 'under') return THEME.dofUnder;
      }
      return null;
    },
  };

  let drawn = 0;
  for (const e of o.extra) drawEntity(doc, e, painter, { ...opt, overrideColor: () => null });
  for (const e of doc.entities) {
    if (!ids.has(e.id)) continue;
    drawEntity(doc, e, painter, opt);
    drawn++;
  }
  // 選択図形は最前面に描き直す
  for (const id of o.selection) {
    const e = doc.entities.find((x) => x.id === id);
    if (e && ids.has(id)) drawEntity(doc, e, painter, opt);
  }
  ctx.restore();
  return { drawn };
}

function drawGrid(ctx: CanvasRenderingContext2D, vp: Viewport, o: SceneOptions): void {
  let sp = o.grid.spacingUm;
  // 画面上で細かすぎるときは間引く
  while (sp * vp.scale < 8) sp *= 10;
  const vis = vp.visibleBBox(0);
  const x0 = Math.floor(vis.x1 / sp) * sp, x1 = vis.x2;
  const y0 = Math.floor(vis.y1 / sp) * sp, y1 = vis.y2;
  const maxLines = 400;
  if ((x1 - x0) / sp > maxLines || (y1 - y0) / sp > maxLines) return;

  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.strokeStyle = o.darkTheme ? THEME.grid : '#eceff3';
  for (let x = x0; x <= x1; x += sp) {
    if (Math.abs(Math.round(x / (sp * 10)) * sp * 10 - x) < 1) continue;
    const px = Math.round(vp.sx(x)) + 0.5;
    ctx.moveTo(px, 0); ctx.lineTo(px, vp.height);
  }
  for (let y = y0; y <= y1; y += sp) {
    if (Math.abs(Math.round(y / (sp * 10)) * sp * 10 - y) < 1) continue;
    const py = Math.round(vp.sy(y)) + 0.5;
    ctx.moveTo(0, py); ctx.lineTo(vp.width, py);
  }
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = o.darkTheme ? THEME.gridMajor : '#dfe4ea';
  const sp10 = sp * 10;
  for (let x = Math.floor(vis.x1 / sp10) * sp10; x <= x1; x += sp10) {
    const px = Math.round(vp.sx(x)) + 0.5;
    ctx.moveTo(px, 0); ctx.lineTo(px, vp.height);
  }
  for (let y = Math.floor(vis.y1 / sp10) * sp10; y <= y1; y += sp10) {
    const py = Math.round(vp.sy(y)) + 0.5;
    ctx.moveTo(0, py); ctx.lineTo(vp.width, py);
  }
  ctx.stroke();

  // 原点軸
  ctx.beginPath();
  ctx.strokeStyle = o.darkTheme ? THEME.axis : '#c8cfd8';
  ctx.lineWidth = 1.5;
  const ox = Math.round(vp.sx(0)) + 0.5, oy = Math.round(vp.sy(0)) + 0.5;
  if (ox > 0 && ox < vp.width) { ctx.moveTo(ox, 0); ctx.lineTo(ox, vp.height); }
  if (oy > 0 && oy < vp.height) { ctx.moveTo(0, oy); ctx.lineTo(vp.width, oy); }
  ctx.stroke();
}

// ------------------------------------------------------------ 補助表示

export function drawSelectionBox(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, crossing: boolean): void {
  ctx.save();
  ctx.setLineDash(crossing ? [5, 4] : []);
  ctx.strokeStyle = crossing ? '#3ddc84' : '#7fd1ff';
  ctx.fillStyle = crossing ? 'rgba(61,220,132,0.10)' : 'rgba(127,209,255,0.10)';
  ctx.lineWidth = 1;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  ctx.fillRect(x, y, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.strokeRect(x + 0.5, y + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  ctx.restore();
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, vp: Viewport, p: { x: number; y: number }, size = 0): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(200,210,225,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (size > 0) {
    ctx.moveTo(p.x - size, p.y); ctx.lineTo(p.x + size, p.y);
    ctx.moveTo(p.x, p.y - size); ctx.lineTo(p.x, p.y + size);
  } else {
    ctx.moveTo(0, p.y + 0.5); ctx.lineTo(vp.width, p.y + 0.5);
    ctx.moveTo(p.x + 0.5, 0); ctx.lineTo(p.x + 0.5, vp.height);
  }
  ctx.stroke();
  ctx.restore();
}

/** 選択図形のグリップ（四角ハンドル） */
export function drawGrips(ctx: CanvasRenderingContext2D, vp: Viewport, pts: Pt[]): void {
  ctx.save();
  ctx.fillStyle = '#1b6dff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  for (const p of pts) {
    const x = vp.sx(p.x), y = vp.sy(p.y);
    ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
    ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
  }
  ctx.restore();
}

export function entityScreenBBox(doc: CadDocument, e: Entity, vp: Viewport): { x: number; y: number; w: number; h: number } {
  const b = entBBox(doc, e);
  const x1 = vp.sx(b.x1), y1 = vp.sy(b.y2), x2 = vp.sx(b.x2), y2 = vp.sy(b.y1);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export { fmtMM };
