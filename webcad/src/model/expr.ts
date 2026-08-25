/**
 * 変数と計算式（仕様 4-3）。
 * 例）板厚 = 3 / 穴径 = 8 / 穴ピッチ = 穴径 * 3
 * 値の単位は mm（利用者から見た単位）。整数µmへの変換は利用側で行う。
 */

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: (a) => Math.sin((a * Math.PI) / 180),
  cos: (a) => Math.cos((a * Math.PI) / 180),
  tan: (a) => Math.tan((a * Math.PI) / 180),
  asin: (a) => (Math.asin(a) * 180) / Math.PI,
  acos: (a) => (Math.acos(a) * 180) / Math.PI,
  atan: (a) => (Math.atan(a) * 180) / Math.PI,
  atan2: (a, b) => (Math.atan2(a, b) * 180) / Math.PI,
  sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  min: Math.min, max: Math.max, pow: Math.pow, hypot: Math.hypot,
};
const CONSTS: Record<string, number> = { pi: Math.PI, PI: Math.PI, e: Math.E };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (!Number.isFinite(v)) throw new Error(`数値が不正です: ${src.slice(i, j)}`);
      out.push({ t: 'num', v });
      i = j; continue;
    }
    // 識別子: 英数字・アンダースコア・日本語（漢字/かな/カナ/全角英数）
    if (/[A-Za-z_々぀-ヿ㐀-鿿０-ｚ]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_々぀-ヿ㐀-鿿０-ｚ]/.test(src[j])) j++;
      out.push({ t: 'id', v: src.slice(i, j) });
      i = j; continue;
    }
    if ('+-*/^(),%'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    // 全角演算子も受け付ける
    const z = '＋－×÷（），'.indexOf(c);
    if (z >= 0) { out.push({ t: 'op', v: '+-*/(),'[z] }); i++; continue; }
    throw new Error(`使えない文字です: ${c}`);
  }
  return out;
}

export class ExprError extends Error {}

/** 式を評価する。vars は 変数名→値(mm)。 */
export function evalExpr(src: string, vars: Record<string, number> = {}): number {
  const toks = tokenize(src);
  let p = 0;
  const peek = (): Tok | undefined => toks[p];
  const eat = (v: string): boolean => {
    const t = toks[p];
    if (t && t.t === 'op' && t.v === v) { p++; return true; }
    return false;
  };

  function primary(): number {
    const t = toks[p];
    if (!t) throw new ExprError('式が途中で終わっています');
    if (t.t === 'num') { p++; return t.v; }
    if (t.t === 'op' && t.v === '(') { p++; const v = expr(); if (!eat(')')) throw new ExprError('括弧が閉じていません'); return v; }
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) { p++; const v = unary(); return t.v === '-' ? -v : v; }
    if (t.t === 'id') {
      p++;
      const name = t.v;
      if (peek()?.t === 'op' && (peek() as { v: string }).v === '(') {
        p++;
        const args: number[] = [];
        if (!eat(')')) {
          do { args.push(expr()); } while (eat(','));
          if (!eat(')')) throw new ExprError(`関数 ${name} の括弧が閉じていません`);
        }
        const f = FUNCS[name];
        if (!f) throw new ExprError(`未知の関数です: ${name}`);
        return f(...args);
      }
      if (name in vars) return vars[name];
      if (name in CONSTS) return CONSTS[name];
      throw new ExprError(`未定義の変数です: ${name}`);
    }
    throw new ExprError(`式が不正です: ${JSON.stringify(t)}`);
  }
  function unary(): number { return primary(); }
  function power(): number {
    const base = unary();
    if (eat('^')) return Math.pow(base, power());
    return base;
  }
  function term(): number {
    let v = power();
    for (;;) {
      if (eat('*')) v *= power();
      else if (eat('/')) { const d = power(); if (d === 0) throw new ExprError('0で割っています'); v /= d; }
      else if (eat('%')) { const d = power(); if (d === 0) throw new ExprError('0で割っています'); v %= d; }
      else return v;
    }
  }
  function expr(): number {
    let v = term();
    for (;;) {
      if (eat('+')) v += term();
      else if (eat('-')) v -= term();
      else return v;
    }
  }
  const v = expr();
  if (p !== toks.length) throw new ExprError('式の末尾に余分な文字があります');
  if (!Number.isFinite(v)) throw new ExprError('計算結果が数値になりません');
  return v;
}

/** 変数表を解決する（依存関係を含む）。循環参照は検出してエラーにする。 */
export function resolveVars(list: { name: string; expr: string }[]): { values: Record<string, number>; errors: Record<string, string> } {
  const values: Record<string, number> = {};
  const errors: Record<string, string> = {};
  const state = new Map<string, 'doing' | 'done'>();
  const byName = new Map(list.map((v) => [v.name, v]));

  const visit = (name: string, stack: string[]): void => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'doing') { errors[name] = `循環参照です: ${[...stack, name].join(' → ')}`; return; }
    const v = byName.get(name);
    if (!v) return;
    state.set(name, 'doing');
    // 依存先を先に解決
    for (const dep of dependencies(v.expr)) {
      if (byName.has(dep)) visit(dep, [...stack, name]);
    }
    try {
      values[name] = evalExpr(v.expr, values);
      delete errors[name];
    } catch (e) {
      errors[name] = e instanceof Error ? e.message : String(e);
    }
    state.set(name, 'done');
  };
  for (const v of list) visit(v.name, []);
  return { values, errors };
}

export function dependencies(src: string): string[] {
  try {
    return tokenize(src).filter((t): t is { t: 'id'; v: string } => t.t === 'id').map((t) => t.v);
  } catch { return []; }
}
