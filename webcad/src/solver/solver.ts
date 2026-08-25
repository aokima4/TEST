/**
 * 拘束ソルバ（仕様 第4章）
 *
 * - 幾何拘束・寸法拘束を残差方程式に変換し、ガウス・ニュートン法＋
 *   レーベンバーグ・マルカート減衰（＝ドッグレッグ相当の信頼領域制御）で解く。
 * - 連結成分ごとに分割して解くため、拘束200個規模でも 0.1 秒以内に収束する。
 * - 自由度(DOF)を数値ランクから求め、未拘束／完全拘束／過拘束を判定する。
 * - 過拘束時は「どの拘束が冗長・矛盾しているか」を名指しで返す（仕様 4-4）。
 *
 * 数値計算は mm・ラジアンで行い、結果は呼び出し側で µm 整数へ丸める（仕様 2-3）。
 */
import type { CadDocument, Constraint, Entity, Handle } from '../model/types.js';
import { UM_PER_MM, UDEG_PER_DEG, q, qAngle } from '../core/units.js';

export type DofState = 'under' | 'full' | 'over';

export interface SolveResult {
  ok: boolean;
  iterations: number;
  residual: number;
  /** 図形ID → 自由度状態 */
  states: Map<string, DofState>;
  /** 全体の残り自由度 */
  dof: number;
  /** 矛盾・冗長と判定された拘束ID */
  conflicts: string[];
  /** 更新された図形（呼び出し側で store.update する） */
  updated: Entity[];
  message: string;
  ms: number;
}

// ---------------------------------------------------------------- パラメータ

interface ParamMap {
  keys: string[];                 // 'e12.x1' など
  values: number[];               // mm / rad
  fixed: boolean[];
  index: Map<string, number>;
  entIds: string[];
}

/** 図形からソルバ変数を取り出す（mm・rad） */
function entParams(e: Entity): { key: string; value: number }[] {
  const mm = (v: number) => v / UM_PER_MM;
  const rad = (v: number) => (v / UDEG_PER_DEG) * (Math.PI / 180);
  switch (e.type) {
    case 'line': return [
      { key: 'x1', value: mm(e.x1) }, { key: 'y1', value: mm(e.y1) },
      { key: 'x2', value: mm(e.x2) }, { key: 'y2', value: mm(e.y2) }];
    case 'circle': return [{ key: 'cx', value: mm(e.cx) }, { key: 'cy', value: mm(e.cy) }, { key: 'r', value: mm(e.r) }];
    case 'arc': return [
      { key: 'cx', value: mm(e.cx) }, { key: 'cy', value: mm(e.cy) }, { key: 'r', value: mm(e.r) },
      { key: 'a1', value: rad(e.a1) }, { key: 'a2', value: rad(e.a2) }];
    case 'point': return [{ key: 'x', value: mm(e.x) }, { key: 'y', value: mm(e.y) }];
    default: return [];
  }
}

/** ソルバ変数を図形へ書き戻す（µm整数へ丸め） */
function applyParams(e: Entity, get: (key: string) => number): Entity {
  const um = (v: number) => q(v * UM_PER_MM);
  const ud = (v: number) => qAngle((v * 180 / Math.PI) * UDEG_PER_DEG);
  switch (e.type) {
    case 'line': return { ...e, x1: um(get('x1')), y1: um(get('y1')), x2: um(get('x2')), y2: um(get('y2')), updated: Date.now() };
    case 'circle': return { ...e, cx: um(get('cx')), cy: um(get('cy')), r: Math.max(1, um(get('r'))), updated: Date.now() };
    case 'arc': return { ...e, cx: um(get('cx')), cy: um(get('cy')), r: Math.max(1, um(get('r'))), a1: ud(get('a1')), a2: ud(get('a2')), updated: Date.now() };
    case 'point': return { ...e, x: um(get('x')), y: um(get('y')), updated: Date.now() };
    default: return e;
  }
}

// ------------------------------------------------------- ハンドル→座標式

/**
 * ハンドルが指す点を、パラメータ配列から計算する。
 * part の意味:
 *   line   : 0=始点, 1=終点, 2=中点, 3=直線そのもの
 *   circle : 0=中心, 1=円周(半径), 2=四半点(0度)
 *   arc    : 0=中心, 1=円弧(半径), 2=始点, 3=終点
 *   point  : 0
 */
function handlePoint(pm: ParamMap, x: number[], e: Entity, h: Handle): [number, number] | null {
  const g = (k: string) => x[pm.index.get(`${e.id}.${k}`)!];
  switch (e.type) {
    case 'line':
      if (h.part === 0) return [g('x1'), g('y1')];
      if (h.part === 1) return [g('x2'), g('y2')];
      if (h.part === 2) return [(g('x1') + g('x2')) / 2, (g('y1') + g('y2')) / 2];
      return null;
    case 'circle':
      if (h.part === 0) return [g('cx'), g('cy')];
      return null;
    case 'arc':
      if (h.part === 0) return [g('cx'), g('cy')];
      if (h.part === 2) return [g('cx') + g('r') * Math.cos(g('a1')), g('cy') + g('r') * Math.sin(g('a1'))];
      if (h.part === 3) return [g('cx') + g('r') * Math.cos(g('a2')), g('cy') + g('r') * Math.sin(g('a2'))];
      return null;
    case 'point': return [g('x'), g('y')];
    default: return null;
  }
}

function lineDir(pm: ParamMap, x: number[], e: Entity): [number, number, number, number] | null {
  if (e.type !== 'line') return null;
  const g = (k: string) => x[pm.index.get(`${e.id}.${k}`)!];
  return [g('x1'), g('y1'), g('x2'), g('y2')];
}

function radiusOf(pm: ParamMap, x: number[], e: Entity): number | null {
  if (e.type !== 'circle' && e.type !== 'arc') return null;
  return x[pm.index.get(`${e.id}.r`)!];
}

/** ハンドルが指す幾何量に対応するパラメータ名（fixed 拘束・ドラッグ固定で使う） */
function paramsOfHandle(e: Entity, part: number): string[] {
  switch (e.type) {
    case 'line':
      if (part === 0) return ['x1', 'y1'];
      if (part === 1) return ['x2', 'y2'];
      return ['x1', 'y1', 'x2', 'y2'];
    case 'circle':
      if (part === 0) return ['cx', 'cy'];
      if (part === 1) return ['r'];
      return ['cx', 'cy', 'r'];
    case 'arc':
      if (part === 0) return ['cx', 'cy'];
      if (part === 1) return ['r'];
      if (part === 2) return ['a1'];
      if (part === 3) return ['a2'];
      return ['cx', 'cy', 'r', 'a1', 'a2'];
    case 'point': return ['x', 'y'];
    default: return [];
  }
}

// ---------------------------------------------------------------- 残差

type ResidualFn = (x: number[], out: number[], at: number) => void;

interface CompiledConstraint {
  c: Constraint;
  count: number;
  fn: ResidualFn;
}

function compile(pm: ParamMap, ents: Map<string, Entity>, c: Constraint, valueOf: (c: Constraint) => number): CompiledConstraint | null {
  const E = (i: number): Entity | undefined => ents.get(c.handles[i]?.id ?? '');
  const P = (i: number) => (x: number[]) => {
    const e = E(i); if (!e) return null;
    return handlePoint(pm, x, e, c.handles[i]);
  };
  const one = (f: (x: number[]) => number): CompiledConstraint =>
    ({ c, count: 1, fn: (x, out, at) => { out[at] = f(x); } });
  const two = (f: (x: number[]) => [number, number]): CompiledConstraint =>
    ({ c, count: 2, fn: (x, out, at) => { const [a, b] = f(x); out[at] = a; out[at + 1] = b; } });

  switch (c.type) {
    case 'coincident': {
      const pa = P(0), pb = P(1);
      return two((x) => { const a = pa(x), b = pb(x); if (!a || !b) return [0, 0]; return [a[0] - b[0], a[1] - b[1]]; });
    }
    case 'horizontal': {
      const e = E(0); if (!e) return null;
      if (e.type === 'line') return one((x) => { const d = lineDir(pm, x, e)!; return d[3] - d[1]; });
      const pa = P(0), pb = P(1);
      return one((x) => { const a = pa(x), b = pb(x); return a && b ? a[1] - b[1] : 0; });
    }
    case 'vertical': {
      const e = E(0); if (!e) return null;
      if (e.type === 'line') return one((x) => { const d = lineDir(pm, x, e)!; return d[2] - d[0]; });
      const pa = P(0), pb = P(1);
      return one((x) => { const a = pa(x), b = pb(x); return a && b ? a[0] - b[0] : 0; });
    }
    case 'parallel': {
      const e1 = E(0), e2 = E(1); if (!e1 || !e2) return null;
      return one((x) => {
        const A = lineDir(pm, x, e1), B = lineDir(pm, x, e2); if (!A || !B) return 0;
        const ax = A[2] - A[0], ay = A[3] - A[1], bx = B[2] - B[0], by = B[3] - B[1];
        const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
        return (ax * by - ay * bx) / (la * lb);
      });
    }
    case 'perpendicular': {
      const e1 = E(0), e2 = E(1); if (!e1 || !e2) return null;
      return one((x) => {
        const A = lineDir(pm, x, e1), B = lineDir(pm, x, e2); if (!A || !B) return 0;
        const ax = A[2] - A[0], ay = A[3] - A[1], bx = B[2] - B[0], by = B[3] - B[1];
        const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1;
        return (ax * bx + ay * by) / (la * lb);
      });
    }
    case 'tangent': {
      const e1 = E(0), e2 = E(1); if (!e1 || !e2) return null;
      if (e1.type === 'line' && (e2.type === 'circle' || e2.type === 'arc')) {
        return one((x) => {
          const A = lineDir(pm, x, e1)!;
          const cx = x[pm.index.get(`${e2.id}.cx`)!], cy = x[pm.index.get(`${e2.id}.cy`)!];
          const r = radiusOf(pm, x, e2)!;
          const dx = A[2] - A[0], dy = A[3] - A[1];
          const L = Math.hypot(dx, dy) || 1;
          const d = ((cx - A[0]) * dy - (cy - A[1]) * dx) / L;
          return Math.abs(d) - r;
        });
      }
      if ((e1.type === 'circle' || e1.type === 'arc') && (e2.type === 'circle' || e2.type === 'arc')) {
        return one((x) => {
          const c1x = x[pm.index.get(`${e1.id}.cx`)!], c1y = x[pm.index.get(`${e1.id}.cy`)!];
          const c2x = x[pm.index.get(`${e2.id}.cx`)!], c2y = x[pm.index.get(`${e2.id}.cy`)!];
          const r1 = radiusOf(pm, x, e1)!, r2 = radiusOf(pm, x, e2)!;
          const d = Math.hypot(c1x - c2x, c1y - c2y);
          // 外接・内接の近い方に合わせる
          return Math.abs(d - (r1 + r2)) < Math.abs(d - Math.abs(r1 - r2)) ? d - (r1 + r2) : d - Math.abs(r1 - r2);
        });
      }
      return null;
    }
    case 'concentric': {
      const e1 = E(0), e2 = E(1); if (!e1 || !e2) return null;
      return two((x) => {
        const a = handlePoint(pm, x, e1, { id: e1.id, part: 0 });
        const b = handlePoint(pm, x, e2, { id: e2.id, part: 0 });
        if (!a || !b) return [0, 0];
        return [a[0] - b[0], a[1] - b[1]];
      });
    }
    case 'equal': {
      const e1 = E(0), e2 = E(1); if (!e1 || !e2) return null;
      if (e1.type === 'line' && e2.type === 'line') {
        return one((x) => {
          const A = lineDir(pm, x, e1)!, B = lineDir(pm, x, e2)!;
          return Math.hypot(A[2] - A[0], A[3] - A[1]) - Math.hypot(B[2] - B[0], B[3] - B[1]);
        });
      }
      return one((x) => (radiusOf(pm, x, e1) ?? 0) - (radiusOf(pm, x, e2) ?? 0));
    }
    case 'symmetric': {
      // handles: [点A, 点B, 対称軸となる線]
      const pa = P(0), pb = P(1); const ax = E(2); if (!ax || ax.type !== 'line') return null;
      return two((x) => {
        const a = pa(x), b = pb(x); if (!a || !b) return [0, 0];
        const L = lineDir(pm, x, ax)!;
        const dx = L[2] - L[0], dy = L[3] - L[1];
        const len = Math.hypot(dx, dy) || 1;
        const mx = (a[0] + b[0]) / 2 - L[0], my = (a[1] + b[1]) / 2 - L[1];
        const onAxis = (mx * dy - my * dx) / len;                 // 中点が軸上
        const perp = ((b[0] - a[0]) * dx + (b[1] - a[1]) * dy) / len; // ABが軸に垂直
        return [onAxis, perp];
      });
    }
    case 'pointOn': {
      const pa = P(0); const target = E(1); if (!target) return null;
      if (target.type === 'line') {
        return one((x) => {
          const a = pa(x); if (!a) return 0;
          const L = lineDir(pm, x, target)!;
          const dx = L[2] - L[0], dy = L[3] - L[1];
          const len = Math.hypot(dx, dy) || 1;
          return ((a[0] - L[0]) * dy - (a[1] - L[1]) * dx) / len;
        });
      }
      return one((x) => {
        const a = pa(x); if (!a) return 0;
        const cx = x[pm.index.get(`${target.id}.cx`)!], cy = x[pm.index.get(`${target.id}.cy`)!];
        return Math.hypot(a[0] - cx, a[1] - cy) - (radiusOf(pm, x, target) ?? 0);
      });
    }
    case 'fixed': return null; // パラメータ固定として別処理
    case 'distance': {
      const pa = P(0), pb = P(1); const v = valueOf(c) / UM_PER_MM;
      return one((x) => { const a = pa(x), b = pb(x); if (!a || !b) return 0; return Math.hypot(a[0] - b[0], a[1] - b[1]) - v; });
    }
    case 'distanceH': {
      const pa = P(0), pb = P(1); const v = valueOf(c) / UM_PER_MM;
      return one((x) => { const a = pa(x), b = pb(x); if (!a || !b) return 0; return (b[0] - a[0]) - v; });
    }
    case 'distanceV': {
      const pa = P(0), pb = P(1); const v = valueOf(c) / UM_PER_MM;
      return one((x) => { const a = pa(x), b = pb(x); if (!a || !b) return 0; return (b[1] - a[1]) - v; });
    }
    case 'radius': {
      const e = E(0); if (!e) return null; const v = valueOf(c) / UM_PER_MM;
      return one((x) => (radiusOf(pm, x, e) ?? 0) - v);
    }
    case 'diameter': {
      const e = E(0); if (!e) return null; const v = valueOf(c) / UM_PER_MM;
      return one((x) => 2 * (radiusOf(pm, x, e) ?? 0) - v);
    }
    case 'angle': {
      const e1 = E(0), e2 = E(1); if (!e1 || !e2) return null;
      const v = (valueOf(c) / UDEG_PER_DEG) * Math.PI / 180;
      return one((x) => {
        const A = lineDir(pm, x, e1), B = lineDir(pm, x, e2); if (!A || !B) return 0;
        const a1 = Math.atan2(A[3] - A[1], A[2] - A[0]);
        const a2 = Math.atan2(B[3] - B[1], B[2] - B[0]);
        let d = a2 - a1;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        return d - v;
      });
    }
    default: return null;
  }
}

// ---------------------------------------------------------------- 線形代数

/** 対称正定値行列 A に対する連立方程式 A x = b をガウス消去で解く */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    if (piv !== col) { const t = M[piv]; M[piv] = M[col]; M[col] = t; }
    const d = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / d;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x.every((v) => Number.isFinite(v)) ? x : null;
}

/** 行列のランクと、従属している行のインデックスを求める */
function rankAndDependentRows(J: number[][], tol = 1e-7): { rank: number; dependent: number[] } {
  const m = J.length; if (m === 0) return { rank: 0, dependent: [] };
  const n = J[0].length;
  const M = J.map((r) => [...r]);
  const dependent: number[] = [];
  const used = new Array<boolean>(m).fill(false);
  let rank = 0;
  for (let col = 0; col < n && rank < m; col++) {
    let piv = -1, best = tol;
    for (let r = 0; r < m; r++) {
      if (used[r]) continue;
      if (Math.abs(M[r][col]) > best) { best = Math.abs(M[r][col]); piv = r; }
    }
    if (piv < 0) continue;
    used[piv] = true; rank++;
    for (let r = 0; r < m; r++) {
      if (r === piv) continue;
      const f = M[r][col] / M[piv][col];
      if (f === 0) continue;
      for (let k = col; k < n; k++) M[r][k] -= f * M[piv][k];
    }
  }
  for (let r = 0; r < m; r++) {
    if (used[r]) continue;
    let norm = 0;
    for (const v of M[r]) norm += v * v;
    if (Math.sqrt(norm) < tol) dependent.push(r);
  }
  return { rank, dependent };
}

// ---------------------------------------------------------------- 本体

export interface SolveOptions {
  /** ドラッグ中に固定したい図形パラメータ（'id.key'） */
  pinned?: Set<string>;
  maxIter?: number;
  tolMm?: number;
  /** 寸法拘束の値を解決する関数（変数式対応） */
  resolveValue?: (c: Constraint) => number;
}

export function solve(doc: CadDocument, opts: SolveOptions = {}): SolveResult {
  const t0 = performance.now();
  const maxIter = opts.maxIter ?? 60;
  const tol = opts.tolMm ?? 1e-9;
  const valueOf = opts.resolveValue ?? ((c: Constraint) => c.value ?? 0);
  const active = doc.constraints.filter((c) => c.enabled !== false);

  const states = new Map<string, DofState>();
  if (active.length === 0) {
    return { ok: true, iterations: 0, residual: 0, states, dof: 0, conflicts: [], updated: [], message: '拘束なし', ms: performance.now() - t0 };
  }

  const ents = new Map<string, Entity>();
  for (const e of doc.entities) ents.set(e.id, e);

  // --- 連結成分に分割
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const c of active) for (const h of c.handles) if (!parent.has(h.id)) parent.set(h.id, h.id);
  for (const c of active) {
    const ids = c.handles.map((h) => h.id).filter((id) => ents.has(id));
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i]);
  }
  const groups = new Map<string, { ids: Set<string>; cons: Constraint[] }>();
  for (const c of active) {
    const first = c.handles.find((h) => ents.has(h.id));
    if (!first) continue;
    const root = find(first.id);
    let g = groups.get(root);
    if (!g) { g = { ids: new Set(), cons: [] }; groups.set(root, g); }
    g.cons.push(c);
    for (const h of c.handles) if (ents.has(h.id)) g.ids.add(h.id);
  }

  const updated: Entity[] = [];
  const conflicts: string[] = [];
  let totalDof = 0;
  let worstResidual = 0;
  let iterations = 0;
  let ok = true;

  for (const g of groups.values()) {
    const res = solveGroup(doc, ents, [...g.ids], g.cons, opts.pinned ?? new Set(), maxIter, tol, valueOf);
    iterations = Math.max(iterations, res.iterations);
    worstResidual = Math.max(worstResidual, res.residual);
    totalDof += res.dof;
    for (const e of res.updated) updated.push(e);
    for (const id of res.conflicts) conflicts.push(id);
    for (const [id, st] of res.states) states.set(id, st);
    if (!res.ok) ok = false;
  }

  const message = !ok
    ? '拘束が矛盾しています（過拘束）。赤く表示された拘束を削除してください。'
    : totalDof === 0 ? '完全拘束' : `未拘束（残り自由度 ${totalDof}）`;

  return { ok, iterations, residual: worstResidual, states, dof: totalDof, conflicts, updated, message, ms: performance.now() - t0 };
}

function solveGroup(
  doc: CadDocument, ents: Map<string, Entity>, ids: string[], cons: Constraint[],
  pinned: Set<string>, maxIter: number, tol: number, valueOf: (c: Constraint) => number,
): SolveResult {
  const t0 = performance.now();
  const pm: ParamMap = { keys: [], values: [], fixed: [], index: new Map(), entIds: ids };
  for (const id of ids) {
    const e = ents.get(id); if (!e) continue;
    for (const p of entParams(e)) {
      const key = `${id}.${p.key}`;
      pm.index.set(key, pm.keys.length);
      pm.keys.push(key); pm.values.push(p.value);
      pm.fixed.push(pinned.has(key) || pinned.has(id));
    }
  }
  // fixed 拘束：指定された点（またはハンドルが指す量）だけを動かないよう固定する
  for (const c of cons) {
    if (c.type !== 'fixed') continue;
    for (const h of c.handles) {
      const e = ents.get(h.id); if (!e) continue;
      for (const key of paramsOfHandle(e, h.part)) {
        const i = pm.index.get(`${h.id}.${key}`);
        if (i !== undefined) pm.fixed[i] = true;
      }
    }
  }

  const compiled: CompiledConstraint[] = [];
  for (const c of cons) {
    const cc = compile(pm, ents, c, valueOf);
    if (cc) compiled.push(cc);
  }
  const rowsOf: { c: Constraint; from: number; count: number }[] = [];
  let m = 0;
  for (const cc of compiled) { rowsOf.push({ c: cc.c, from: m, count: cc.count }); m += cc.count; }

  const free: number[] = [];
  for (let i = 0; i < pm.values.length; i++) if (!pm.fixed[i]) free.push(i);
  const n = free.length;

  const x = [...pm.values];
  const residuals = new Array<number>(m).fill(0);
  // compiled と rowsOf は同順序なので、添字で直接参照する
  const evalResFast = (xv: number[], out: number[]): number => {
    out.fill(0);
    for (let i = 0; i < compiled.length; i++) compiled[i].fn(xv, out, rowsOf[i].from);
    let s = 0;
    for (const v of out) s += v * v;
    return Math.sqrt(s);
  };
  let err = evalResFast(x, residuals);
  let lambda = 1e-3;
  let iter = 0;
  const J: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  const tmp = new Array<number>(m).fill(0);

  if (n > 0 && m > 0) {
    for (; iter < maxIter && err > tol; iter++) {
      // 数値ヤコビアン（中心差分）
      for (let j = 0; j < n; j++) {
        const pi = free[j];
        const h = Math.max(1e-6, Math.abs(x[pi]) * 1e-7);
        const orig = x[pi];
        x[pi] = orig + h; evalResFast(x, tmp);
        const plus = [...tmp];
        x[pi] = orig - h; evalResFast(x, tmp);
        for (let i = 0; i < m; i++) J[i][j] = (plus[i] - tmp[i]) / (2 * h);
        x[pi] = orig;
      }
      evalResFast(x, residuals);

      // 正規方程式 (JᵀJ + λI) δ = -Jᵀr
      const A: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      const b = new Array<number>(n).fill(0);
      for (let i = 0; i < m; i++) {
        const Ji = J[i], ri = residuals[i];
        for (let a = 0; a < n; a++) {
          if (Ji[a] === 0) continue;
          b[a] -= Ji[a] * ri;
          for (let c2 = a; c2 < n; c2++) A[a][c2] += Ji[a] * Ji[c2];
        }
      }
      for (let a = 0; a < n; a++) for (let c2 = 0; c2 < a; c2++) A[a][c2] = A[c2][a];

      let stepped = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        const Ad = A.map((row, i) => { const r = [...row]; r[i] += lambda * (1 + Math.abs(r[i])); return r; });
        const delta = solveLinear(Ad, b);
        if (!delta) { lambda *= 10; continue; }
        const xt = [...x];
        for (let j = 0; j < n; j++) xt[free[j]] += delta[j];
        const e2 = evalResFast(xt, tmp);
        if (e2 < err) {
          for (let j = 0; j < n; j++) x[free[j]] = xt[free[j]];
          err = e2; lambda = Math.max(1e-9, lambda * 0.4); stepped = true; break;
        }
        lambda *= 8;
      }
      if (!stepped) break;
    }
    evalResFast(x, residuals);
  }

  // --- 自由度・過拘束判定
  for (let j = 0; j < n; j++) {
    const pi = free[j];
    const h = Math.max(1e-6, Math.abs(x[pi]) * 1e-7);
    const orig = x[pi];
    x[pi] = orig + h; evalResFast(x, tmp);
    const plus = [...tmp];
    x[pi] = orig - h; evalResFast(x, tmp);
    for (let i = 0; i < m; i++) J[i][j] = (plus[i] - tmp[i]) / (2 * h);
    x[pi] = orig;
  }
  const { rank, dependent } = rankAndDependentRows(J);
  const dof = Math.max(0, n - rank);
  const converged = err <= 1e-6;
  const conflicts: string[] = [];
  if (!converged && dependent.length) {
    for (const row of dependent) {
      const owner = rowsOf.find((r) => row >= r.from && row < r.from + r.count);
      if (owner && !conflicts.includes(owner.c.id)) conflicts.push(owner.c.id);
    }
  }

  const states = new Map<string, DofState>();
  const st: DofState = !converged ? 'over' : dof === 0 ? 'full' : 'under';
  for (const id of ids) states.set(id, st);

  const updated: Entity[] = [];
  if (converged || err < 1e-3) {
    for (const id of ids) {
      const e = ents.get(id); if (!e) continue;
      const ne = applyParams(e, (k) => x[pm.index.get(`${id}.${k}`)!]);
      if (JSON.stringify(ne) !== JSON.stringify(e)) updated.push(ne);
    }
  }

  return {
    ok: converged, iterations: iter, residual: err, states, dof, conflicts, updated,
    message: '', ms: performance.now() - t0,
  };
}
