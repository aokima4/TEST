/**
 * ドキュメントの単一の変更窓口。
 * すべての変更をトランザクションとして記録し、100手順以上の Undo/Redo を保証する（仕様 5-5）。
 * 差分のみを保持するため、図形5万個でも履歴のメモリは実用範囲に収まる。
 */
import type { CadDocument, Entity, BlockDef, Constraint, Layer, SheetDef } from './types.js';
import { SpatialIndex, entBBox, rebuildIndex, newId } from './doc.js';

interface MetaSnapshot {
  layers: Layer[];
  blocks: Record<string, BlockDef>;
  constraints: Constraint[];
  variables: { name: string; expr: string }[];
  sheet: SheetDef;
  currentLayer: string;
  name: string;
}

interface Change {
  label: string;
  added: Entity[];
  removed: Entity[];
  changed: { before: Entity; after: Entity }[];
  metaBefore?: MetaSnapshot;
  metaAfter?: MetaSnapshot;
  /** 変更前後の nextId（Undo後にIDが再利用されないようにする） */
  nextIdBefore: number;
  nextIdAfter: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function snapMeta(doc: CadDocument): MetaSnapshot {
  return clone({
    layers: doc.layers, blocks: doc.blocks, constraints: doc.constraints,
    variables: doc.variables, sheet: doc.sheet, currentLayer: doc.currentLayer, name: doc.name,
  });
}

function applyMeta(doc: CadDocument, m: MetaSnapshot): void {
  const c = clone(m);
  doc.layers = c.layers; doc.blocks = c.blocks; doc.constraints = c.constraints;
  doc.variables = c.variables; doc.sheet = c.sheet; doc.currentLayer = c.currentLayer; doc.name = c.name;
}

export const MAX_UNDO = 300; // 仕様は「100手順以上」

export class Store {
  doc: CadDocument;
  index = new SpatialIndex();
  byId = new Map<string, Entity>();
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  private cur: Change | null = null;
  private listeners = new Set<(reason: string) => void>();
  /** トランザクション確定前に走る整合処理（寸法の追従など） */
  private reconcilers: (() => void)[] = [];
  private reconciling = false;
  /** 保存済みとみなす履歴位置 */
  private savedMark = 0;

  constructor(doc: CadDocument) {
    this.doc = doc;
    this.reindex();
  }

  reindex(): void {
    this.byId.clear();
    for (const e of this.doc.entities) this.byId.set(e.id, e);
    rebuildIndex(this.doc, this.index);
  }

  onChange(fn: (reason: string) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(reason: string): void { for (const f of this.listeners) f(reason); }

  get dirty(): boolean { return this.undoStack.length !== this.savedMark; }
  markSaved(): void { this.savedMark = this.undoStack.length; }

  newId(): string { return newId(this.doc); }

  // ------------------------------------------------------------ トランザクション

  tx<T>(label: string, fn: () => T): T {
    const nested = this.cur !== null;
    if (!nested) {
      this.cur = { label, added: [], removed: [], changed: [], nextIdBefore: this.doc.nextId, nextIdAfter: this.doc.nextId };
    }
    let result: T;
    try {
      result = fn();
    } catch (err) {
      if (!nested) { this.rollback(); }
      throw err;
    }
    if (!nested) {
      this.runReconcilers();
      this.commit();
    }
    return result;
  }

  /** 図形変更に追従させたい処理を登録する（例：寸法の関連付け更新） */
  addReconciler(fn: () => void): void { this.reconcilers.push(fn); }

  private runReconcilers(): void {
    if (this.reconciling) return;
    this.reconciling = true;
    try { for (const f of this.reconcilers) f(); }
    finally { this.reconciling = false; }
  }

  private rollback(): void {
    const c = this.cur;
    this.cur = null;
    if (!c) return;
    for (const e of c.added) this.rawRemove(e.id);
    for (const e of c.removed) this.rawAdd(e);
    for (const ch of c.changed) this.rawReplace(ch.before);
    if (c.metaBefore) applyMeta(this.doc, c.metaBefore);
    this.doc.nextId = c.nextIdBefore;
    this.emit('rollback');
  }

  private commit(): void {
    const c = this.cur;
    this.cur = null;
    if (!c) return;
    if (c.metaBefore) c.metaAfter = snapMeta(this.doc);
    c.nextIdAfter = this.doc.nextId;
    const empty = c.added.length === 0 && c.removed.length === 0 && c.changed.length === 0 && !c.metaBefore;
    if (!empty) {
      this.undoStack.push(c);
      if (this.undoStack.length > MAX_UNDO) {
        this.undoStack.shift();
        if (this.savedMark > 0) this.savedMark--;
      }
      this.redoStack.length = 0;
    }
    this.emit(c.label);
  }

  /** レイヤ・ブロック・拘束・変数・図面枠など、図形以外の変更を記録する */
  touchMeta(): void {
    if (this.cur && !this.cur.metaBefore) this.cur.metaBefore = snapMeta(this.doc);
  }

  // ------------------------------------------------------------ 図形の追加削除

  private rawAdd(e: Entity): void {
    this.doc.entities.push(e);
    this.byId.set(e.id, e);
    this.index.insert(e.id, entBBox(this.doc, e));
  }
  private rawRemove(id: string): Entity | null {
    const i = this.doc.entities.findIndex((x) => x.id === id);
    if (i < 0) return null;
    const [e] = this.doc.entities.splice(i, 1);
    this.byId.delete(id);
    this.index.remove(id);
    return e;
  }
  private rawReplace(e: Entity): void {
    const i = this.doc.entities.findIndex((x) => x.id === e.id);
    if (i < 0) { this.rawAdd(e); return; }
    this.doc.entities[i] = e;
    this.byId.set(e.id, e);
    this.index.insert(e.id, entBBox(this.doc, e));
  }

  add(e: Entity): Entity {
    this.rawAdd(e);
    this.cur?.added.push(e);
    return e;
  }

  remove(id: string): void {
    const e = this.rawRemove(id);
    if (e) this.cur?.removed.push(e);
    // 依存する寸法・ハッチも削除
    const deps = this.doc.entities.filter(
      (x) => (x.type === 'dim' && x.refs.includes(id)) || (x.type === 'hatch' && x.boundary.includes(id)),
    );
    for (const d of deps) {
      const r = this.rawRemove(d.id);
      if (r) this.cur?.removed.push(r);
    }
    // 依存する拘束も削除
    const cs = this.doc.constraints.filter((c) => c.handles.some((h) => h.id === id));
    if (cs.length) {
      this.touchMeta();
      this.doc.constraints = this.doc.constraints.filter((c) => !c.handles.some((h) => h.id === id));
    }
  }

  update(e: Entity): Entity {
    const before = this.byId.get(e.id);
    if (before && before !== e) this.cur?.changed.push({ before, after: e });
    this.rawReplace(e);
    return e;
  }

  get(id: string): Entity | undefined { return this.byId.get(id); }

  /**
   * ドラッグ中の一時表示用。履歴に残さずに図形を差し替える。
   * 確定時は必ず元へ戻してから tx() で本更新すること。
   */
  silentUpdate(e: Entity): void {
    this.rawReplace(e);
    this.emit('preview');
  }

  // ------------------------------------------------------------ Undo / Redo

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  get undoLabel(): string { return this.undoStack.at(-1)?.label ?? ''; }
  get redoLabel(): string { return this.redoStack.at(-1)?.label ?? ''; }

  undo(): boolean {
    const c = this.undoStack.pop();
    if (!c) return false;
    for (let i = c.added.length - 1; i >= 0; i--) this.rawRemove(c.added[i].id);
    for (const e of c.removed) this.rawAdd(e);
    for (let i = c.changed.length - 1; i >= 0; i--) this.rawReplace(c.changed[i].before);
    if (c.metaBefore) applyMeta(this.doc, c.metaBefore);
    this.doc.nextId = c.nextIdAfter; // IDは戻さない（再利用による衝突を防ぐ）
    this.redoStack.push(c);
    this.emit('undo:' + c.label);
    return true;
  }

  redo(): boolean {
    const c = this.redoStack.pop();
    if (!c) return false;
    for (const e of c.removed) this.rawRemove(e.id);
    for (const e of c.added) this.rawAdd(e);
    for (const ch of c.changed) this.rawReplace(ch.after);
    if (c.metaAfter) applyMeta(this.doc, c.metaAfter);
    this.doc.nextId = Math.max(this.doc.nextId, c.nextIdAfter);
    this.undoStack.push(c);
    this.emit('redo:' + c.label);
    return true;
  }

  /** 履歴を含めて別ドキュメントへ差し替え */
  load(doc: CadDocument): void {
    this.doc = doc;
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.cur = null;
    this.savedMark = 0;
    this.reindex();
    this.emit('load');
  }
}
