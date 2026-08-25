/**
 * 単位・精度の基盤（要件仕様書 第2章）
 *
 * 内部単位はすべて「1マイクロメートル(1/1000 mm) = 1」の整数。
 * 角度は「1/1,000,000 度 = 1」の整数（0 〜 359,999,999）。
 *
 * JavaScript の number は 2^53-1 (=9,007,199,254,740,991) までの整数を
 * 誤差なく厳密に表現する。本アプリの座標範囲は ±2,000,000mm = ±2e9 µm であり、
 * 加減算・整数倍を何度繰り返しても安全整数域を出ないため、整数演算は厳密。
 * （BigInt は不要かつ遅いため採用しない。仕様 2-2 の「64ビット整数」要件は
 *   「厳密な整数演算」の意図として number の安全整数域で満たす。）
 */

/** 1mm = 1000 µm */
export const UM_PER_MM = 1000;
/** 1度 = 1,000,000 µdeg */
export const UDEG_PER_DEG = 1_000_000;
/** 全周 = 360,000,000 µdeg */
export const FULL_TURN = 360 * UDEG_PER_DEG;
/** 座標の許容範囲 ±2,000,000mm */
export const COORD_LIMIT = 2_000_000 * UM_PER_MM;

/** 一致判定の許容差（仕様 2-4） */
export const TOL = {
  /** 点と点が同一とみなす距離: 1µm */
  point: 1,
  /** 平行判定の角度差: 0.000001度 = 1 µdeg */
  angleUDeg: 1,
  /** 図形が閉じている判定: 端点間 1µm */
  close: 1,
} as const;

/**
 * 仕様 2-3: 小数計算の結果を保存する瞬間に、1µm単位の整数へ丸める。
 * 丸め方は「四捨五入（ちょうど0.5のときは偶数側へ）」＝銀行家の丸め。
 */
export function roundHalfEven(v: number): number {
  if (!Number.isFinite(v)) throw new RangeError(`丸め不能な値: ${v}`);
  const f = Math.floor(v);
  const diff = v - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  // ちょうど 0.5 → 偶数側へ
  return f % 2 === 0 ? f : f + 1;
}

/** 小数(µm)を厳密な整数µmへ確定する。座標を保存する直前に必ず通す。 */
export function q(v: number): number {
  const r = roundHalfEven(v);
  if (Math.abs(r) > COORD_LIMIT) {
    throw new RangeError(`座標が範囲外です: ${fmtMM(r)}mm（上限 ±2,000,000mm）`);
  }
  return r;
}

/** 角度(µdeg 小数)を 0..359,999,999 の整数へ正規化する。 */
export function qAngle(v: number): number {
  let a = roundHalfEven(v) % FULL_TURN;
  if (a < 0) a += FULL_TURN;
  return a;
}

/** mm(小数) → µm(整数) */
export function mmToUm(mm: number): number {
  return q(mm * UM_PER_MM);
}

/** µm(整数) → mm(小数) */
export function umToMm(um: number): number {
  return um / UM_PER_MM;
}

/** deg(小数) → µdeg(整数) */
export function degToUDeg(deg: number): number {
  return qAngle(deg * UDEG_PER_DEG);
}

/** µdeg → deg(小数) */
export function uDegToDeg(ud: number): number {
  return ud / UDEG_PER_DEG;
}

/** µdeg → radian(小数)。三角関数へ渡す用。 */
export function uDegToRad(ud: number): number {
  return (ud / UDEG_PER_DEG) * (Math.PI / 180);
}

/** radian → µdeg(整数, 正規化済) */
export function radToUDeg(rad: number): number {
  return qAngle((rad * 180) / Math.PI * UDEG_PER_DEG);
}

/**
 * 表示用の文字列（mm、小数点以下3桁まで。末尾の0は落とさず桁を固定）。
 * 仕様 2-2「表示単位 mm（小数点以下3桁まで表示。例：100.000）」
 */
export function fmtMM(um: number, digits = 3): string {
  const sign = um < 0 ? '-' : '';
  const a = Math.abs(um);
  const int = Math.floor(a / UM_PER_MM);
  const frac = a - int * UM_PER_MM; // 0..999 の整数
  if (digits <= 0) return `${sign}${int}`;
  const fs = String(frac).padStart(3, '0').slice(0, Math.min(3, digits));
  return `${sign}${int}.${fs.padEnd(digits, '0')}`;
}

/** 表示用の角度文字列（度、小数点以下は指定桁） */
export function fmtDeg(udeg: number, digits = 3): string {
  return (udeg / UDEG_PER_DEG).toFixed(digits);
}

/** 数式を含まない単純な mm 入力のパース。失敗時 null。 */
export function parseMM(text: string): number | null {
  const t = text.trim().replace(/[,\s]/g, '');
  if (t === '') return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return mmToUm(v);
}

/** 角度入力のパース（度）。失敗時 null。 */
export function parseDeg(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return degToUDeg(v);
}

/** すべての座標値が厳密な整数であることの検査（開発時の不変条件チェック） */
export function assertInt(...vals: number[]): void {
  for (const v of vals) {
    if (!Number.isInteger(v)) {
      throw new TypeError(`整数でない座標値が混入しました: ${v}`);
    }
  }
}
