/** 画面座標(px) ↔ 図面座標(µm) の変換とズーム・パン */
import type { Pt, BBox } from '../core/geom.js';
import { pt } from '../core/geom.js';
import { UM_PER_MM } from '../core/units.js';

export class Viewport {
  /** 画面1pxあたりのµm数の逆数: px = um * scale */
  scale = 0.02;          // 初期: 1px = 50µm → 1mm = 20px
  /** 画面中心が指す図面座標 */
  cx = 0;
  cy = 0;
  width = 800;
  height = 600;
  dpr = 1;

  resize(w: number, h: number, dpr: number): void {
    this.width = w; this.height = h; this.dpr = dpr;
  }

  toScreen(p: Pt): { x: number; y: number } {
    return {
      x: (p.x - this.cx) * this.scale + this.width / 2,
      y: this.height / 2 - (p.y - this.cy) * this.scale,
    };
  }
  sx(x: number): number { return (x - this.cx) * this.scale + this.width / 2; }
  sy(y: number): number { return this.height / 2 - (y - this.cy) * this.scale; }

  /** 画面座標→図面座標（整数µmへ丸める） */
  toWorld(x: number, y: number): Pt {
    return pt(this.cx + (x - this.width / 2) / this.scale, this.cy + (this.height / 2 - y) / this.scale);
  }
  /** 丸めない図面座標（判定用） */
  toWorldRaw(x: number, y: number): Pt {
    return { x: this.cx + (x - this.width / 2) / this.scale, y: this.cy + (this.height / 2 - y) / this.scale };
  }

  /** 画面px → 図面µm の長さ */
  pxToUm(px: number): number { return px / this.scale; }
  umToPx(um: number): number { return um * this.scale; }

  zoomAt(sxp: number, syp: number, factor: number): void {
    const before = this.toWorldRaw(sxp, syp);
    this.scale = Math.min(200, Math.max(2e-6, this.scale * factor));
    const after = this.toWorldRaw(sxp, syp);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
  }

  panPx(dx: number, dy: number): void {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  fit(b: BBox, marginRatio = 0.08): void {
    if (!(b.x1 <= b.x2 && b.y1 <= b.y2)) return;
    const w = Math.max(1000, b.x2 - b.x1), h = Math.max(1000, b.y2 - b.y1);
    const s = Math.min(this.width / w, this.height / h) * (1 - marginRatio * 2);
    this.scale = Math.min(200, Math.max(2e-6, s));
    this.cx = (b.x1 + b.x2) / 2;
    this.cy = (b.y1 + b.y2) / 2;
  }

  /** 表示中の図面範囲 */
  visibleBBox(padPx = 0): BBox {
    const a = this.toWorldRaw(-padPx, this.height + padPx);
    const b = this.toWorldRaw(this.width + padPx, -padPx);
    return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }

  /** 現在の表示倍率（画面上の1mmが何pxか） */
  get pxPerMm(): number { return this.scale * UM_PER_MM; }
}
