/** アプリ本体：状態管理・入力処理・描画ループ・コマンド実行 */
import type { CadDocument, Entity, Constraint } from '../model/types.js';
import { emptyDocument } from '../model/types.js';
import { Store } from '../model/store.js';
import { Viewport } from '../view/viewport.js';
import { entBBox, docBBox, distToEntity, entSegs, handlePointOf, attachmentAt } from '../model/doc.js';
import { renderScene, drawSelectionBox, drawGrips, CanvasPainter, THEME } from '../render/canvas.js';
import type { SceneOptions } from '../render/canvas.js';
import { findSnap, defaultSnapSettings, drawSnapMarker, SNAP_LABEL } from '../snap/snap.js';
import type { SnapSettings, SnapHit } from '../snap/snap.js';
import type { Pt, BBox } from '../core/geom.js';
import { pt, dist, angleOf, polar, bboxOverlap, bboxContains } from '../core/geom.js';
import { fmtMM, mmToUm, degToUDeg, UDEG_PER_DEG, qAngle, q } from '../core/units.js';
import { solve } from '../solver/solver.js';
import type { DofState } from '../solver/solver.js';
import { resolveVars, evalExpr } from '../model/expr.js';
import { buildFrame } from '../sheet/frame.js';
import { localStore } from './storage.js';
import type { Painter } from '../render/painter.js';

// ------------------------------------------------------------ 入力要求

export interface PointReq {
  kind: 'point'; prompt: string; base?: Pt | null;
  preview?: (p: Pt, painter: Painter, ctx: CanvasRenderingContext2D) => void;
  keywords?: string[];
  optional?: boolean;
}
export interface EntityReq { kind: 'entity'; prompt: string; filter?: (e: Entity) => boolean }
export interface EntitiesReq { kind: 'entities'; prompt: string; filter?: (e: Entity) => boolean; useSelection?: boolean }
export interface NumberReq { kind: 'number'; prompt: string; default?: number; unit?: 'mm' | 'deg' | 'raw' }
export interface TextReq { kind: 'text'; prompt: string; default?: string }
export interface KeywordReq { kind: 'keyword'; prompt: string; options: { key: string; label: string }[] }

export type Req = PointReq | EntityReq | EntitiesReq | NumberReq | TextReq | KeywordReq;
export type CmdGen = Generator<Req, void, never>;
export type Command = (app: App) => Generator<Req, void, any>;

export interface CommandDef {
  name: string;         // 正式名 '線'
  alias: string[];      // ['L','LINE','せん']
  hint: string;
  run: Command;
  group: '作図' | '編集' | '寸法' | '拘束' | 'ファイル' | '表示' | 'その他';
  icon?: string;
}

export interface AppOptions {
  ortho: boolean;
  grid: boolean;
  gridSpacingUm: number;
  showLineweight: boolean;
  showDof: boolean;
  showFrame: boolean;
  autoSolve: boolean;
  darkTheme: boolean;
  crosshair: boolean;
}

export class App {
  store: Store;
  vp = new Viewport();
  snap: SnapSettings = defaultSnapSettings();
  selection = new Set<string>();
  hover: string | null = null;
  options: AppOptions = {
    ortho: false, grid: true, gridSpacingUm: 10_000, showLineweight: true,
    showDof: true, showFrame: true, autoSolve: true, darkTheme: true, crosshair: true,
  };
  canvas!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D;

  // 入力状態
  private gen: Generator<Req, void, unknown> | null = null;
  private cur: Req | null = null;
  private curCommand: CommandDef | null = null;
  cursor = { x: 0, y: 0 };
  worldCursor: Pt = { x: 0, y: 0 };
  snapHit: SnapHit | null = null;
  private pickedEntities: Entity[] = [];
  lastPoint: Pt | null = null;

  // ドラッグ
  private panning = false;
  private panLast = { x: 0, y: 0 };
  private boxStart: { x: number; y: number } | null = null;
  private dragging: { ids: string[]; start: Pt; snapshot: Entity[] } | null = null;
  private gripDrag: { id: string; index: number; snapshot: Entity; last: Entity | null } | null = null;

  // 拘束
  dofStates: Map<string, DofState> = new Map();
  conflicts: string[] = [];
  solverMsg = '';
  varValues: Record<string, number> = {};
  varErrors: Record<string, string> = {};

  // 表示
  private needsRedraw = true;
  fps = 0;
  private frameTimes: number[] = [];
  lastRenderMs = 0;
  drawnCount = 0;

  commands = new Map<string, CommandDef>();
  private listeners: Record<string, ((...a: never[]) => void)[]> = {};
  statusText = '';
  docKey = 'current';
  private autosaveTimer: number | null = null;
  private commandHistory: string[] = [];

  constructor(doc: CadDocument = emptyDocument()) {
    this.store = new Store(doc);
    this.store.onChange(() => { this.invalidate(); this.emit('change'); });
    // 図形を変形したら、関連付けた寸法の計測点と数値を自動で追従させる（仕様 6-1）
    this.store.addReconciler(() => this.syncDimensions());
  }

  /** 関連付けのある寸法を、対象図形の現在の形に合わせて更新する */
  syncDimensions(): void {
    for (const e of [...this.doc.entities]) {
      if (e.type !== 'dim') continue;
      let p1 = e.p1, p2 = e.p2;
      let changed = false;
      if (e.attach1) {
        const np = handlePointOf(this.doc, e.attach1);
        if (np && (np.x !== p1.x || np.y !== p1.y)) { p1 = np; changed = true; }
      }
      if (e.attach2) {
        const np = handlePointOf(this.doc, e.attach2);
        if (np && (np.x !== p2.x || np.y !== p2.y)) { p2 = np; changed = true; }
      }
      // 半径・直径寸法は、対象の円が変わったら中心と円周点を作り直す
      if ((e.kind === 'radius' || e.kind === 'diameter') && e.refs.length) {
        const c = this.store.get(e.refs[0]);
        if (c && (c.type === 'circle' || c.type === 'arc')) {
          const center = { x: c.cx, y: c.cy };
          const ang = angleOf(center, e.p2);
          const on = polar(center, ang, c.r);
          if (center.x !== p1.x || center.y !== p1.y || on.x !== p2.x || on.y !== p2.y) {
            p1 = center; p2 = on; changed = true;
          }
        }
      }
      if (changed) this.store.update({ ...e, p1, p2, updated: Date.now() });
    }
  }

  /** いま入力された点が図形のどの部位かを返す（寸法の関連付け用） */
  attachmentFor(p: Pt): { id: string; part: number } | null {
    const id = this.snapHit?.entityId;
    if (!id) return null;
    return attachmentAt(this.doc, id, p);
  }

  // ------------------------------------------------------------ イベント

  on(name: string, fn: (...a: never[]) => void): void {
    (this.listeners[name] ??= []).push(fn);
  }
  emit(name: string, ...args: unknown[]): void {
    for (const f of this.listeners[name] ?? []) (f as (...a: unknown[]) => void)(...args);
  }

  get doc(): CadDocument { return this.store.doc; }

  invalidate(): void { this.needsRedraw = true; }

  // ------------------------------------------------------------ 初期化

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D を初期化できませんでした');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); this.cancel(); });
    canvas.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    requestAnimationFrame(() => this.loop());
    this.startAutosave();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.vp.resize(rect.width, rect.height, dpr);
    this.invalidate();
  }

  // ------------------------------------------------------------ 描画ループ

  private loop(): void {
    if (this.needsRedraw) {
      const t0 = performance.now();
      this.render();
      this.lastRenderMs = performance.now() - t0;
      this.needsRedraw = false;
      const now = performance.now();
      this.frameTimes.push(now);
      while (this.frameTimes.length > 30 && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
      const span = now - this.frameTimes[0];
      this.fps = span > 0 ? Math.round(((this.frameTimes.length - 1) * 1000) / span) : 0;
    }
    requestAnimationFrame(() => this.loop());
  }

  frameEntities(): Entity[] {
    if (!this.options.showFrame || !this.doc.sheet.showFrame) return [];
    return buildFrame(this.doc.sheet).entities;
  }

  render(): void {
    const o: SceneOptions = {
      grid: { on: this.options.grid, spacingUm: this.options.gridSpacingUm },
      showLineweight: this.options.showLineweight,
      selection: this.selection,
      hover: this.hover,
      dofColors: this.doc.constraints.length ? this.dofStates : null,
      showDof: this.options.showDof,
      extra: this.frameEntities(),
      darkTheme: this.options.darkTheme,
    };
    const r = renderScene(this.ctx, this.vp, this.doc, this.store.index, o);
    this.drawnCount = r.drawn;

    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.vp.dpr, 0, 0, this.vp.dpr, 0, 0);

    // 過拘束の拘束を赤く表示
    if (this.conflicts.length) this.drawConflicts(ctx);

    // コマンドのプレビュー
    if (this.cur?.kind === 'point' && this.cur.preview) {
      const p = this.currentInputPoint();
      const painter = new CanvasPainter(ctx, this.vp, this.options.showLineweight);
      ctx.save();
      ctx.setLineDash([4, 3]);
      this.cur.preview(p, painter, ctx);
      ctx.restore();
    }

    // 選択枠
    if (this.boxStart) {
      drawSelectionBox(ctx, this.boxStart, this.cursor, this.cursor.x < this.boxStart.x);
    }

    // グリップ
    if (this.selection.size && this.selection.size <= 50 && !this.gen) {
      const pts: Pt[] = [];
      for (const id of this.selection) {
        const e = this.store.get(id);
        if (e) pts.push(...gripsOf(this.doc, e));
      }
      drawGrips(ctx, this.vp, pts.slice(0, 400));
    }

    // スナップマーカー
    if (this.snapHit) {
      const s = this.vp.toScreen(this.snapHit.p);
      drawSnapMarker(ctx, s.x, s.y, this.snapHit.type, THEME.snap);
    }

    // 十字カーソル
    if (this.options.crosshair && this.gen) {
      ctx.save();
      ctx.strokeStyle = 'rgba(180,195,215,0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, this.cursor.y + 0.5); ctx.lineTo(this.vp.width, this.cursor.y + 0.5);
      ctx.moveTo(this.cursor.x + 0.5, 0); ctx.lineTo(this.cursor.x + 0.5, this.vp.height);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawConflicts(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.strokeStyle = THEME.dofOver;
    ctx.lineWidth = 2;
    for (const cid of this.conflicts) {
      const c = this.doc.constraints.find((x) => x.id === cid);
      if (!c) continue;
      for (const h of c.handles) {
        const e = this.store.get(h.id);
        if (!e) continue;
        const b = entBBox(this.doc, e);
        const x = this.vp.sx(b.x1), y = this.vp.sy(b.y2);
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x - 4, y - 4, (b.x2 - b.x1) * this.vp.scale + 8, (b.y2 - b.y1) * this.vp.scale + 8);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------ 入力

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this.vp.zoomAt(e.clientX - rect.left, e.clientY - rect.top, f);
    this.updateSnap();
    this.invalidate();
    this.emit('status');
  }

  private onPointerDown(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    this.cursor = { x, y };
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      this.panning = true; this.panLast = { x, y };
      this.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 2) return;

    if (this.cur) {
      this.supplyFromClick(x, y);
      return;
    }
    // 選択中の図形のグリップを掴んだら、その点だけを動かす
    const grip = this.gripAt(x, y);
    if (grip) {
      const e = this.store.get(grip.id);
      if (e) { this.gripDrag = { id: grip.id, index: grip.index, snapshot: e, last: null }; return; }
    }
    // 通常の選択操作
    const hit = this.pickAt(x, y);
    if (hit) {
      if (this.selection.has(hit.id) && !e.shiftKey) {
        // 選択済み図形の上で押した → ドラッグ移動を開始
        this.dragging = {
          ids: [...this.selection], start: this.worldSnapped(),
          snapshot: [...this.selection].map((id) => this.store.get(id)!).filter(Boolean),
        };
        return;
      }
      if (!e.shiftKey) this.selection.clear();
      if (e.shiftKey && this.selection.has(hit.id)) this.selection.delete(hit.id);
      else this.selection.add(hit.id);
      this.emit('selection');
      this.invalidate();
    } else {
      if (!e.shiftKey) { this.selection.clear(); this.emit('selection'); }
      this.boxStart = { x, y };
      this.invalidate();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    if (this.panning) {
      this.vp.panPx(x - this.panLast.x, y - this.panLast.y);
      this.panLast = { x, y };
      this.invalidate();
      this.emit('status');
      return;
    }
    this.cursor = { x, y };
    this.worldCursor = this.vp.toWorld(x, y);
    this.updateSnap();

    if (this.gripDrag) {
      // ドラッグ中は履歴に残さず表示だけ更新する（確定は pointerup で1回）
      const moved = moveGrip(this.doc, this.gripDrag.snapshot, this.gripDrag.index, this.worldSnapped());
      if (moved) { this.gripDrag.last = moved; this.store.silentUpdate(moved); }
      this.invalidate();
      this.emit('status');
      return;
    }
    if (this.dragging) {
      const now = this.worldSnapped();
      const dx = now.x - this.dragging.start.x, dy = now.y - this.dragging.start.y;
      for (const e2 of this.dragging.snapshot) this.store.silentUpdate(translateEntity(this.doc, e2, dx, dy));
      this.invalidate();
      this.emit('status');
      return;
    }
    if (!this.cur && !this.boxStart) {
      const hit = this.pickAt(x, y);
      const id = hit?.id ?? null;
      if (id !== this.hover) { this.hover = id; this.invalidate(); }
    }
    this.invalidate();
    this.emit('status');
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.panning) { this.panning = false; return; }
    if (this.gripDrag) {
      const g = this.gripDrag;
      this.gripDrag = null;
      if (g.last) {
        this.store.silentUpdate(g.snapshot);           // いったん元に戻し…
        const final = g.last;
        this.store.tx('グリップ編集', () => { this.store.update(final); });  // …1手順として記録する
      }
      this.runSolver();
      this.invalidate();
      return;
    }
    if (this.dragging) {
      const now = this.worldSnapped();
      const dx = now.x - this.dragging.start.x, dy = now.y - this.dragging.start.y;
      const d = this.dragging;
      this.dragging = null;
      for (const e2 of d.snapshot) this.store.silentUpdate(e2);   // いったん元へ戻す
      if (dx !== 0 || dy !== 0) {
        this.store.tx('移動', () => {
          for (const e2 of d.snapshot) {
            const moved = translateEntity(this.doc, e2, dx, dy);
            this.store.update(moved);
          }
        });
        this.runSolver();
      }
      this.invalidate();
      return;
    }
    if (this.boxStart) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      const crossing = x < this.boxStart.x;
      const a = this.vp.toWorldRaw(Math.min(this.boxStart.x, x), Math.max(this.boxStart.y, y));
      const b = this.vp.toWorldRaw(Math.max(this.boxStart.x, x), Math.min(this.boxStart.y, y));
      const box: BBox = { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
      const moved = Math.abs(x - this.boxStart.x) > 3 || Math.abs(y - this.boxStart.y) > 3;
      this.boxStart = null;
      if (moved) {
        for (const id of this.store.index.query(box)) {
          const ent = this.store.get(id);
          if (!ent) continue;
          const layer = this.doc.layers.find((l) => l.name === ent.layer);
          if (layer && (!layer.visible || layer.locked)) continue;
          const eb = entBBox(this.doc, ent);
          if (crossing ? bboxOverlap(box, eb) : bboxContains(box, eb)) this.selection.add(id);
        }
        this.emit('selection');
      }
      this.invalidate();
    }
  }

  private onDoubleClick(e: PointerEvent | MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const hit = this.pickAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) this.emit('editEntity', hit);
  }

  // ------------------------------------------------------------ 選択・スナップ

  /** 選択中の図形のグリップのうち、カーソル近傍のものを返す */
  gripAt(x: number, y: number): { id: string; index: number } | null {
    if (!this.selection.size) return null;
    const tol = 7;
    for (const id of this.selection) {
      const e = this.store.get(id);
      if (!e) continue;
      const pts = gripsOf(this.doc, e);
      for (let i = 0; i < pts.length; i++) {
        const s = this.vp.toScreen(pts[i]);
        if (Math.abs(s.x - x) <= tol && Math.abs(s.y - y) <= tol) return { id, index: i };
      }
    }
    return null;
  }

  pickAt(x: number, y: number): Entity | null {
    const w = this.vp.toWorldRaw(x, y);
    const tolUm = this.vp.pxToUm(6);
    const box: BBox = { x1: w.x - tolUm, y1: w.y - tolUm, x2: w.x + tolUm, y2: w.y + tolUm };
    let best: Entity | null = null, bestD = Infinity;
    for (const id of this.store.index.query(box)) {
      const e = this.store.get(id);
      if (!e) continue;
      const layer = this.doc.layers.find((l) => l.name === e.layer);
      if (layer && (!layer.visible || layer.locked)) continue;
      const d = distToEntity(this.doc, e, w);
      if (d <= tolUm && d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  updateSnap(): void {
    const base = this.cur?.kind === 'point' ? (this.cur.base ?? this.lastPoint) : null;
    this.snapHit = findSnap(this.doc, this.store.index, this.vp, this.cursor, this.snap, base ?? null);
    this.worldCursor = this.snapHit ? this.snapHit.p : this.vp.toWorld(this.cursor.x, this.cursor.y);
  }

  /** スナップ・直交モードを適用した現在の入力点 */
  worldSnapped(): Pt {
    let p = this.snapHit ? this.snapHit.p : this.vp.toWorld(this.cursor.x, this.cursor.y);
    const base = this.cur?.kind === 'point' ? (this.cur.base ?? null) : (this.dragging ? this.dragging.start : null);
    if (this.options.ortho && base) {
      const dx = Math.abs(p.x - base.x), dy = Math.abs(p.y - base.y);
      p = dx >= dy ? pt(p.x, base.y) : pt(base.x, p.y);
    }
    return p;
  }

  currentInputPoint(): Pt { return this.worldSnapped(); }

  // ------------------------------------------------------------ コマンド実行

  register(def: CommandDef): void {
    this.commands.set(def.name, def);
    for (const a of def.alias) this.commands.set(a.toUpperCase(), def);
  }

  findCommand(text: string): CommandDef | null {
    const t = text.trim();
    if (!t) return null;
    return this.commands.get(t) ?? this.commands.get(t.toUpperCase()) ?? null;
  }

  run(def: CommandDef): void {
    this.cancel();
    this.curCommand = def;
    this.commandHistory.push(def.name);
    this.gen = def.run(this) as Generator<Req, void, unknown>;
    this.pickedEntities = [];
    this.pump(undefined);
    this.emit('command', def);
  }

  runByName(name: string): boolean {
    const def = this.findCommand(name);
    if (!def) return false;
    this.run(def);
    return true;
  }

  private pump(value: unknown): void {
    if (!this.gen) return;
    try {
      const r = this.gen.next(value as never);
      if (r.done) { this.finishCommand(); return; }
      this.cur = r.value;
      this.prepareRequest();
    } catch (err) {
      this.setStatus(`エラー: ${err instanceof Error ? err.message : String(err)}`);
      this.finishCommand();
    }
    this.invalidate();
  }

  private prepareRequest(): void {
    const r = this.cur;
    if (!r) return;
    if (r.kind === 'entities' && r.useSelection !== false && this.selection.size) {
      const list = [...this.selection].map((id) => this.store.get(id)!).filter(Boolean)
        .filter((e) => !r.filter || r.filter(e));
      if (list.length) { this.cur = null; this.pump(list); return; }
    }
    this.setStatus(promptOf(r));
    this.emit('prompt', promptOf(r), r);
  }

  private finishCommand(): void {
    this.gen = null; this.cur = null; this.curCommand = null;
    this.pickedEntities = [];
    this.lastPoint = null;
    this.setStatus('コマンド：クリックで選択 / 右クリックで中止');
    this.emit('prompt', '', null);
    this.runSolver();
    this.invalidate();
  }

  cancel(): void {
    if (this.gen) {
      try { this.gen.return(undefined as never); } catch { /* 無視 */ }
      this.setStatus('中止しました');
    } else if (this.selection.size) {
      this.selection.clear();
      this.emit('selection');
    }
    this.gen = null; this.cur = null; this.curCommand = null;
    this.pickedEntities = [];
    this.lastPoint = null;
    this.emit('prompt', '', null);
    this.invalidate();
  }

  private supplyFromClick(x: number, y: number, depth = 0): void {
    const r = this.cur;
    if (!r) return;
    if (r.kind === 'point') {
      const p = this.worldSnapped();
      this.lastPoint = p;
      this.cur = null;
      this.pump(p);
      return;
    }
    if (r.kind === 'entity') {
      const e = this.pickAt(x, y);
      if (!e || (r.filter && !r.filter(e))) { this.setStatus('その図形は選べません。もう一度クリックしてください。'); return; }
      this.cur = null;
      this.pump({ entity: e, point: this.vp.toWorld(x, y) });
      return;
    }
    if (r.kind === 'entities') {
      const e = this.pickAt(x, y);
      if (e && (!r.filter || r.filter(e))) {
        if (!this.pickedEntities.some((p) => p.id === e.id)) {
          this.pickedEntities.push(e);
          this.selection.add(e.id);
        }
        this.setStatus(`${promptOf(r)}（${this.pickedEntities.length}個選択中：Enterで確定）`);
        this.invalidate();
      } else {
        this.boxStart = { x, y };
      }
      return;
    }
    if (r.kind === 'number') {
      // 数値要求中のクリックは「基準点からの距離」として解釈
      const p = this.worldSnapped();
      if (this.lastPoint) {
        const d = dist(this.lastPoint, p);
        this.cur = null;
        this.pump(Math.round(d));
        return;
      }
      if (r.default !== undefined) { this.cur = null; this.pump(r.default); this.forwardClick(x, y, depth); }
      return;
    }
    // 選択肢や文字を待っている最中にクリックされたら、既定の選択肢で先へ進める。
    // （クリックだけ操作していて、何も起きないという行き止まりを作らないため）
    if (r.kind === 'keyword') {
      const def = r.options[0];
      this.setStatus(`${def.label}で進めます`);
      this.cur = null;
      this.pump(def.key);
      this.forwardClick(x, y, depth);
      return;
    }
    if (r.kind === 'text' && r.default !== undefined) {
      this.cur = null;
      this.pump(r.default);
      this.forwardClick(x, y, depth);
      return;
    }
  }

  /** 既定値で進めたあと、同じクリックを次の入力要求へ渡す */
  private forwardClick(x: number, y: number, depth: number): void {
    if (depth >= 3) return;
    const next = this.cur;
    if (next && (next.kind === 'point' || next.kind === 'entity' || next.kind === 'entities')) {
      this.supplyFromClick(x, y, depth + 1);
    }
  }

  /** コマンドラインからの入力を処理する */
  submitInput(text: string): void {
    const t = text.trim();
    const r = this.cur;
    if (!r) {
      if (!t) return;
      if (!this.runByName(t)) this.setStatus(`「${t}」というコマンドはありません`);
      return;
    }
    if (t === '') { // Enter = 確定 / 既定値
      if (r.kind === 'entities') {
        const list = this.pickedEntities.length ? this.pickedEntities
          : [...this.selection].map((id) => this.store.get(id)!).filter(Boolean);
        this.cur = null; this.pump(list);
        return;
      }
      if (r.kind === 'number' && r.default !== undefined) { this.cur = null; this.pump(r.default); return; }
      if (r.kind === 'text' && r.default !== undefined) { this.cur = null; this.pump(r.default); return; }
      if (r.kind === 'point' && r.optional) { this.cur = null; this.pump(null); return; }
      return;
    }
    switch (r.kind) {
      case 'point': {
        if (r.keywords?.some((k) => k.toUpperCase() === t.toUpperCase())) {
          this.cur = null; this.pump({ keyword: t.toUpperCase() });
          return;
        }
        const p = this.parsePoint(t, r.base ?? this.lastPoint ?? null);
        if (!p) { this.setStatus('座標の書き方：100,50 ／ @100,0 ／ @100<45'); return; }
        this.lastPoint = p;
        this.cur = null; this.pump(p);
        return;
      }
      case 'number': {
        const v = this.parseNumber(t, r.unit ?? 'mm');
        if (v === null) { this.setStatus('数値を入力してください（式も可：例 8*3）'); return; }
        this.cur = null; this.pump(v);
        return;
      }
      case 'text': this.cur = null; this.pump(t); return;
      case 'keyword': {
        const opt = r.options.find((o) => o.key.toUpperCase() === t.toUpperCase());
        if (!opt) { this.setStatus(`選択肢：${r.options.map((o) => o.key).join(' / ')}`); return; }
        this.cur = null; this.pump(opt.key);
        return;
      }
      case 'entities': {
        if (t.toUpperCase() === 'ALL' || t === '全て') {
          const list = this.doc.entities.filter((e) => !r.filter || r.filter(e));
          for (const e of list) this.selection.add(e.id);
          this.cur = null; this.pump(list);
        }
        return;
      }
      default: return;
    }
  }

  parseNumber(t: string, unit: 'mm' | 'deg' | 'raw'): number | null {
    try {
      const v = evalExpr(t, this.varValues);
      if (!Number.isFinite(v)) return null;
      return unit === 'mm' ? mmToUm(v) : unit === 'deg' ? degToUDeg(v) : v;
    } catch { return null; }
  }

  /** 100,50 / @100,0 / @100<45 / 100<45 を解釈（仕様 5-3） */
  parsePoint(t: string, base: Pt | null): Pt | null {
    let s = t.trim().replace(/[，]/g, ',').replace(/[＠]/g, '@').replace(/[＜]/g, '<');
    let relative = false;
    if (s.startsWith('@')) { relative = true; s = s.slice(1); }
    const num = (x: string): number | null => {
      try { const v = evalExpr(x, this.varValues); return Number.isFinite(v) ? v : null; } catch { return null; }
    };
    if (s.includes('<')) {
      const [d, a] = s.split('<');
      const dv = num(d), av = num(a);
      if (dv === null || av === null) return null;
      const origin = relative ? (base ?? this.lastPoint ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
      return polar(origin, degToUDeg(av), mmToUm(dv));
    }
    if (s.includes(',')) {
      const [xs, ys] = s.split(',');
      const xv = num(xs), yv = num(ys);
      if (xv === null || yv === null) return null;
      const origin = relative ? (base ?? this.lastPoint ?? { x: 0, y: 0 }) : { x: 0, y: 0 };
      return pt(origin.x + mmToUm(xv), origin.y + mmToUm(yv));
    }
    // 数値のみ：基準点から現在のカーソル方向へその距離
    const v = num(s);
    if (v === null) return null;
    const b = base ?? this.lastPoint;
    if (!b) return null;
    const dir = this.options.ortho
      ? qAngle(Math.round(angleOf(b, this.vp.toWorld(this.cursor.x, this.cursor.y)) / (90 * UDEG_PER_DEG)) * 90 * UDEG_PER_DEG)
      : angleOf(b, this.vp.toWorld(this.cursor.x, this.cursor.y));
    return polar(b, dir, mmToUm(v));
  }

  /** キーボード：Enter/Escape/Space などの共通処理 */
  handleKey(e: KeyboardEvent): boolean {
    if (e.key === 'Escape') { this.cancel(); return true; }
    if (e.key === 'Enter' && this.cur?.kind === 'entities') {
      const list = this.pickedEntities.length ? this.pickedEntities
        : [...this.selection].map((id) => this.store.get(id)!).filter(Boolean);
      this.cur = null; this.pump(list);
      return true;
    }
    if (e.key === 'Delete' && !this.gen && this.selection.size) {
      this.deleteSelection();
      return true;
    }
    if (e.key === 'Shift') { this.options.ortho = true; this.invalidate(); this.emit('options'); return false; }
    return false;
  }

  handleKeyUp(e: KeyboardEvent): void {
    if (e.key === 'Shift') { this.options.ortho = false; this.invalidate(); this.emit('options'); }
  }

  deleteSelection(): void {
    if (!this.selection.size) return;
    const ids = [...this.selection];
    this.store.tx('削除', () => { for (const id of ids) this.store.remove(id); });
    this.selection.clear();
    this.emit('selection');
    this.runSolver();
  }

  setStatus(s: string): void { this.statusText = s; this.emit('status', s); }

  // ------------------------------------------------------------ 拘束

  resolveVariables(): void {
    const r = resolveVars(this.doc.variables);
    this.varValues = r.values;
    this.varErrors = r.errors;
  }

  constraintValue(c: Constraint): number {
    if (c.expr) {
      try {
        const v = evalExpr(c.expr, this.varValues);
        return c.type === 'angle' ? degToUDeg(v) : mmToUm(v);
      } catch { return c.value ?? 0; }
    }
    return c.value ?? 0;
  }

  runSolver(pinned?: Set<string>): void {
    if (!this.options.autoSolve || !this.doc.constraints.length) {
      this.dofStates.clear(); this.conflicts = []; this.solverMsg = '';
      this.emit('solver');
      return;
    }
    this.resolveVariables();
    const res = solve(this.doc, { pinned, resolveValue: (c) => this.constraintValue(c) });
    if (res.updated.length) {
      this.store.tx('拘束の解決', () => {
        for (const e of res.updated) this.store.update(e);
      });
    }
    this.dofStates = res.states;
    this.conflicts = res.conflicts;
    this.solverMsg = `${res.message}／${res.ms.toFixed(1)}ms`;
    this.emit('solver', res);
    this.invalidate();
  }

  // ------------------------------------------------------------ 表示

  zoomExtents(): void {
    const ents = [...this.doc.entities, ...this.frameEntities()];
    const b = ents.length ? docBBox(this.doc, ents) : { x1: 0, y1: 0, x2: 297_000, y2: 210_000 };
    this.vp.fit(b);
    this.invalidate();
    this.emit('status');
  }

  zoomSelection(): void {
    if (!this.selection.size) return this.zoomExtents();
    const ents = [...this.selection].map((id) => this.store.get(id)!).filter(Boolean);
    this.vp.fit(docBBox(this.doc, ents));
    this.invalidate();
  }

  // ------------------------------------------------------------ 自動保存

  startAutosave(): void {
    if (this.autosaveTimer !== null) return;
    this.autosaveTimer = window.setInterval(() => { void this.autosave(); }, 30_000);
    window.addEventListener('beforeunload', () => { void this.autosave(); });
  }

  async autosave(): Promise<void> {
    if (!this.store.dirty) return;
    try {
      await localStore.save(this.docKey, this.doc);
      this.emit('autosaved', Date.now());
    } catch (e) {
      this.setStatus(`自動保存に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  loadDocument(doc: CadDocument): void {
    this.store.load(doc);
    this.selection.clear();
    this.dofStates.clear();
    this.conflicts = [];
    this.resolveVariables();
    this.zoomExtents();
    this.emit('change');
    this.emit('selection');
    this.emit('docloaded');
  }
}

// ------------------------------------------------------------ 補助関数

export function promptOf(r: Req): string {
  switch (r.kind) {
    case 'point': return r.prompt + (r.keywords?.length ? `［${r.keywords.join('/')}］` : '');
    case 'entity': return r.prompt;
    case 'entities': return r.prompt + '（Enterで確定）';
    case 'number': return r.prompt + (r.default !== undefined ? `＜${fmtMM(r.default, 2)}＞` : '');
    case 'text': return r.prompt;
    case 'keyword': return `${r.prompt}［${r.options.map((o) => `${o.key}=${o.label}`).join(' / ')}］`;
  }
}

export function gripsOf(doc: CadDocument, e: Entity): Pt[] {
  switch (e.type) {
    case 'line': return [{ x: e.x1, y: e.y1 }, { x: q((e.x1 + e.x2) / 2), y: q((e.y1 + e.y2) / 2) }, { x: e.x2, y: e.y2 }];
    case 'circle': return [{ x: e.cx, y: e.cy }, { x: e.cx + e.r, y: e.cy }, { x: e.cx, y: e.cy + e.r }];
    case 'arc': {
      const segs = entSegs(doc, e);
      const s = segs[0];
      return s.kind === 'arc' ? [s.c, s.a, s.b] : [];
    }
    case 'polyline': return e.verts.map((v) => ({ x: v.x, y: v.y }));
    case 'point': return [{ x: e.x, y: e.y }];
    case 'text': return [{ x: e.x, y: e.y }];
    case 'insert': return [{ x: e.x, y: e.y }];
    case 'dim': return [e.p1, e.p2, e.p3];
    case 'gtol': return e.leader ? [{ x: e.x, y: e.y }, e.leader] : [{ x: e.x, y: e.y }];
    case 'leader': return [e.from, e.to];
    case 'surf': return [{ x: e.x, y: e.y }];
    default: return [];
  }
}

/**
 * グリップ（□ハンドル）を掴んで動かしたときの図形更新。
 * gripsOf() が返す並び順に対応する。
 */
export function moveGrip(doc: CadDocument, e: Entity, index: number, p: Pt): Entity | null {
  const now = Date.now();
  switch (e.type) {
    case 'line':
      if (index === 0) return { ...e, x1: p.x, y1: p.y, updated: now };
      if (index === 2) return { ...e, x2: p.x, y2: p.y, updated: now };
      { // 中点グリップは線全体を平行移動
        const mx = q((e.x1 + e.x2) / 2), my = q((e.y1 + e.y2) / 2);
        return translateEntity(doc, e, p.x - mx, p.y - my);
      }
    case 'circle':
      if (index === 0) return { ...e, cx: p.x, cy: p.y, updated: now };
      return { ...e, r: Math.max(1, q(Math.hypot(p.x - e.cx, p.y - e.cy))), updated: now };
    case 'arc': {
      const c = { x: e.cx, y: e.cy };
      if (index === 0) return { ...e, cx: p.x, cy: p.y, updated: now };
      const a = angleOf(c, p);
      if (index === 1) return { ...e, a1: a, r: Math.max(1, q(dist(c, p))), updated: now };
      return { ...e, a2: a, updated: now };
    }
    case 'polyline': {
      if (index < 0 || index >= e.verts.length) return null;
      const verts = e.verts.map((v, i) => (i === index ? { ...v, x: p.x, y: p.y } : v));
      return { ...e, verts, updated: now };
    }
    case 'point': case 'text': case 'insert':
      return { ...e, x: p.x, y: p.y, updated: now };
    case 'dim':
      if (index === 0) return { ...e, p1: p, attach1: null, updated: now };
      if (index === 1) return { ...e, p2: p, attach2: null, updated: now };
      return { ...e, p3: p, updated: now };
    case 'gtol':
      return index === 0 ? { ...e, x: p.x, y: p.y, updated: now } : { ...e, leader: p, updated: now };
    case 'leader':
      return index === 0 ? { ...e, from: p, updated: now } : { ...e, to: p, updated: now };
    case 'surf':
      return { ...e, x: p.x, y: p.y, updated: now };
    default: return null;
  }
}

export function translateEntity(doc: CadDocument, e: Entity, dx: number, dy: number): Entity {
  const t = (p: Pt): Pt => ({ x: p.x + dx, y: p.y + dy });
  switch (e.type) {
    case 'line': return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy, updated: Date.now() };
    case 'circle': return { ...e, cx: e.cx + dx, cy: e.cy + dy, updated: Date.now() };
    case 'arc': return { ...e, cx: e.cx + dx, cy: e.cy + dy, updated: Date.now() };
    case 'polyline': return { ...e, verts: e.verts.map((v) => ({ ...v, x: v.x + dx, y: v.y + dy })), updated: Date.now() };
    case 'text': case 'point': case 'insert': return { ...e, x: e.x + dx, y: e.y + dy, updated: Date.now() };
    case 'ellipse': return { ...e, cx: e.cx + dx, cy: e.cy + dy, updated: Date.now() };
    case 'dim': return { ...e, p1: t(e.p1), p2: t(e.p2), p3: t(e.p3), p4: e.p4 ? t(e.p4) : undefined, updated: Date.now() };
    case 'hatch': return e;
    case 'gtol': return { ...e, x: e.x + dx, y: e.y + dy, leader: e.leader ? t(e.leader) : e.leader, updated: Date.now() };
    case 'leader': return { ...e, from: t(e.from), to: t(e.to), updated: Date.now() };
    case 'surf': return { ...e, x: e.x + dx, y: e.y + dy, updated: Date.now() };
  }
}

export { SNAP_LABEL };
