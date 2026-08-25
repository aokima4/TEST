/**
 * 精度・機能の自己診断（仕様 第2章 2-5 / 第11章 検収チェックリスト）
 * 画面の「検証」ボタンからも、npm test からも同じコードが走る。
 */
import { emptyDocument } from '../model/types.js';
import type { CadDocument, LineEnt } from '../model/types.js';
import { mkLine, mkCircle, transformEntity, entSegs } from '../model/doc.js';
import { Store } from '../model/store.js';
import { moveXf, rotateXf } from '../ops/edit.js';
import { writeDxf } from '../io/dxfwrite.js';
import { readDxf } from '../io/dxfread.js';
import { mmToUm, degToUDeg, fmtMM, UM_PER_MM } from '../core/units.js';
import { lineCircleX, dist, pt } from '../core/geom.js';
import { solve } from '../solver/solver.js';
import { toJson, fromJson } from '../io/xcad.js';

export interface TestResult { name: string; ok: boolean; detail: string }

const results: TestResult[] = [];
function check(name: string, fn: () => { ok: boolean; detail: string }): TestResult {
  try {
    const r = fn();
    return { name, ...r };
  } catch (e) {
    return { name, ok: false, detail: `例外: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** ① 100mmの線を10回つなげて、合計がちょうど1000.000mm */
export function testChain100(): { ok: boolean; detail: string } {
  const doc = emptyDocument();
  const store = new Store(doc);
  const L = mmToUm(100);
  let cursor = pt(0, 0);
  const ids: string[] = [];
  store.tx('連結', () => {
    for (let i = 0; i < 10; i++) {
      const next = pt(cursor.x + L, cursor.y);
      const e = store.add(mkLine(doc, cursor, next));
      ids.push(e.id);
      // 「コピー→端点に接続」を模して、次の始点は直前の終点そのものを使う
      const seg = entSegs(doc, store.get(e.id)!)[0];
      cursor = seg.kind === 'line' ? seg.b : cursor;
    }
  });
  const first = store.get(ids[0]) as LineEnt;
  const last = store.get(ids[9]) as LineEnt;
  const total = last.x2 - first.x1;
  return {
    ok: total === mmToUm(1000),
    detail: `合計長さ = ${fmtMM(total, 3)} mm（期待値 1000.000 mm、内部値 ${total} µm）`,
  };
}

/** ② 12345.678mm移動して戻すと座標が完全一致 */
export function testMoveRoundTrip(): { ok: boolean; detail: string } {
  const doc = emptyDocument();
  const e = mkLine(doc, pt(mmToUm(3.7), mmToUm(-11.25)), pt(mmToUm(97.001), mmToUm(42.5)));
  const d = mmToUm(12345.678);
  const moved = transformEntity(doc, e, moveXf(d, d)) as LineEnt;
  const back = transformEntity(doc, moved, moveXf(-d, -d)) as LineEnt;
  const same = back.x1 === e.x1 && back.y1 === e.y1 && back.x2 === e.x2 && back.y2 === e.y2;
  return {
    ok: same,
    detail: same ? '往復後の座標は1µmも違わない' : `不一致: ${JSON.stringify([back.x1 - e.x1, back.y1 - e.y1, back.x2 - e.x2, back.y2 - e.y2])}`,
  };
}

/** ③ 90度回転を4回で完全に元通り */
export function testRotate4(): { ok: boolean; detail: string } {
  const doc = emptyDocument();
  const e = mkLine(doc, pt(mmToUm(13.333), mmToUm(-7.77)), pt(mmToUm(101.5), mmToUm(66.25)));
  const about = pt(mmToUm(23.5), mmToUm(9.125));
  let cur = e;
  for (let i = 0; i < 4; i++) cur = transformEntity(doc, cur, rotateXf(about, degToUDeg(90))) as LineEnt;
  const same = cur.x1 === e.x1 && cur.y1 === e.y1 && cur.x2 === e.x2 && cur.y2 === e.y2;
  return {
    ok: same,
    detail: same ? '4回転で完全に元の座標へ戻った' : `不一致: ${JSON.stringify([cur.x1 - e.x1, cur.y1 - e.y1, cur.x2 - e.x2, cur.y2 - e.y2])}`,
  };
}

/** ④ DXF書き出し→読み込みを5回繰り返しても全座標が不変 */
export function testDxfRoundTrip5(version: 'R12' | '2013' = '2013'): { ok: boolean; detail: string } {
  let doc = sampleDoc();
  const snapshot = (d: CadDocument): string => JSON.stringify(d.entities.map(coordsOf));
  const first = snapshot(doc);
  for (let i = 0; i < 5; i++) {
    const text = writeDxf(doc, { version });
    doc = readDxf(text).doc;
  }
  const after = snapshot(doc);
  return {
    ok: first === after,
    detail: first === after
      ? `${version}形式で5往復しても全座標が完全一致（図形${doc.entities.length}個）`
      : `座標が変化しました:\n  前 ${first.slice(0, 200)}\n  後 ${after.slice(0, 200)}`,
  };
}

/** ⑤ 円と直線の交点にスナップした点が、本当に円上にある */
export function testIntersectionOnCircle(): { ok: boolean; detail: string } {
  const c = pt(mmToUm(30), mmToUm(20));
  const r = mmToUm(17.5);
  const a = pt(mmToUm(-10), mmToUm(3.25)), b = pt(mmToUm(90), mmToUm(41.75));
  const xs = lineCircleX(a, b, c, r);
  if (xs.length !== 2) return { ok: false, detail: `交点が2つ得られませんでした（${xs.length}個）` };
  const errs = xs.map((p) => Math.abs(dist(p, c) - r));
  const worst = Math.max(...errs);
  return {
    ok: worst <= 1,
    detail: `交点の半径誤差 最大 ${worst.toFixed(3)} µm（許容 1µm＝0.001mm）`,
  };
}

/** ⑥ 100回連続でUndoできる */
export function testUndo100(): { ok: boolean; detail: string } {
  const doc = emptyDocument();
  const store = new Store(doc);
  for (let i = 0; i < 120; i++) {
    store.tx(`線${i}`, () => { store.add(mkLine(doc, pt(0, i * 1000), pt(mmToUm(50), i * 1000))); });
  }
  let undone = 0;
  while (store.canUndo && undone < 120) { store.undo(); undone++; }
  return {
    ok: undone >= 100 && doc.entities.length === 0,
    detail: `${undone}回のUndoに成功、残った図形 ${doc.entities.length}個`,
  };
}

/** ⑦ 拘束した長方形の幅を変えると形が正しく追従する */
export function testConstraintRectangle(): { ok: boolean; detail: string } {
  const doc = emptyDocument();
  const store = new Store(doc);
  // わざと歪んだ四角形を作る
  const p = [pt(0, 0), pt(mmToUm(97), mmToUm(3)), pt(mmToUm(101), mmToUm(58)), pt(mmToUm(-2), mmToUm(61))];
  const ls: LineEnt[] = [];
  store.tx('四角形', () => {
    for (let i = 0; i < 4; i++) ls.push(store.add(mkLine(doc, p[i], p[(i + 1) % 4])) as LineEnt);
  });
  const c = (type: string, handles: { id: string; part: number }[], value?: number): void => {
    doc.constraints.push({ id: `c${doc.constraints.length}`, type: type as never, handles, value, enabled: true });
  };
  for (let i = 0; i < 4; i++) c('coincident', [{ id: ls[i].id, part: 1 }, { id: ls[(i + 1) % 4].id, part: 0 }]);
  c('horizontal', [{ id: ls[0].id, part: 3 }]);
  c('horizontal', [{ id: ls[2].id, part: 3 }]);
  c('vertical', [{ id: ls[1].id, part: 3 }]);
  c('vertical', [{ id: ls[3].id, part: 3 }]);
  c('fixed', [{ id: ls[0].id, part: 0 }]);
  c('distanceH', [{ id: ls[0].id, part: 0 }, { id: ls[0].id, part: 1 }], mmToUm(120));
  c('distanceV', [{ id: ls[1].id, part: 0 }, { id: ls[1].id, part: 1 }], mmToUm(80));

  const res = solve(doc);
  for (const e of res.updated) store.update(e);
  const l0 = store.get(ls[0].id) as LineEnt;
  const l1 = store.get(ls[1].id) as LineEnt;
  const w = Math.abs(l0.x2 - l0.x1), hh = Math.abs(l1.y2 - l1.y1);
  const flatTop = Math.abs(l0.y2 - l0.y1);
  const okW = Math.abs(w - mmToUm(120)) <= 2;
  const okH = Math.abs(hh - mmToUm(80)) <= 2;
  const okFlat = flatTop <= 2;
  return {
    ok: okW && okH && okFlat && res.ok,
    detail: `幅 ${fmtMM(w, 3)}mm（期待120）／高さ ${fmtMM(hh, 3)}mm（期待80）／水平誤差 ${flatTop}µm／${res.message}／${res.ms.toFixed(1)}ms`,
  };
}

/** ⑧ 拘束200個で0.1秒以内に解ける（性能要件） */
export function testSolverPerformance(): { ok: boolean; detail: string } {
  const doc = emptyDocument();
  const N = 50;   // 四角形50個 = 拘束 約450個
  let cons = 0;
  for (let k = 0; k < N; k++) {
    const ox = k * mmToUm(150);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const e = mkLine(doc, pt(ox + i * 1000, i * 700), pt(ox + mmToUm(50) + i * 900, mmToUm(30) + i * 500));
      doc.entities.push(e);
      ids.push(e.id);
    }
    for (let i = 0; i < 4; i++) {
      doc.constraints.push({ id: `c${cons++}`, type: 'coincident', handles: [{ id: ids[i], part: 1 }, { id: ids[(i + 1) % 4], part: 0 }], enabled: true });
    }
    doc.constraints.push({ id: `c${cons++}`, type: 'horizontal', handles: [{ id: ids[0], part: 3 }], enabled: true });
    doc.constraints.push({ id: `c${cons++}`, type: 'vertical', handles: [{ id: ids[1], part: 3 }], enabled: true });
    doc.constraints.push({ id: `c${cons++}`, type: 'horizontal', handles: [{ id: ids[2], part: 3 }], enabled: true });
    doc.constraints.push({ id: `c${cons++}`, type: 'vertical', handles: [{ id: ids[3], part: 3 }], enabled: true });
  }
  const t0 = performance.now();
  const res = solve(doc);
  const ms = performance.now() - t0;
  const per200 = (ms / cons) * 200;
  return {
    ok: per200 <= 100,
    detail: `拘束${cons}個を ${ms.toFixed(1)}ms で解決（拘束200個換算 ${per200.toFixed(1)}ms、要件100ms以内）`,
  };
}

/** ⑨ .xcad 保存→読込で完全一致（小数が混ざっていないことも検査） */
export function testXcadRoundTrip(): { ok: boolean; detail: string } {
  const doc = sampleDoc();
  const json = toJson(doc);
  const back = fromJson(json);
  const a = JSON.stringify(doc.entities.map(coordsOf));
  const b = JSON.stringify(back.entities.map(coordsOf));
  return { ok: a === b, detail: a === b ? '保存→読込で全座標が一致（小数の混入なし）' : '座標が変化しました' };
}

function coordsOf(ent: CadDocument['entities'][number]): unknown {
  const e = ent as unknown as { type: string } & Record<string, number | string | boolean | object>;
  switch (e.type) {
    case 'line': return ['line', e.x1, e.y1, e.x2, e.y2];
    case 'circle': return ['circle', e.cx, e.cy, e.r];
    case 'arc': return ['arc', e.cx, e.cy, e.r, e.a1, e.a2];
    case 'polyline': return ['polyline', (e.verts as { x: number; y: number; bulge: number }[]).map((v) => [v.x, v.y, v.bulge]), e.closed];
    case 'text': return ['text', e.x, e.y, e.h, e.text];
    case 'point': return ['point', e.x, e.y];
    default: return [e.type];
  }
}

export function sampleDoc(): CadDocument {
  const doc = emptyDocument('検証用サンプル');
  const L = (x1: number, y1: number, x2: number, y2: number): void => {
    doc.entities.push(mkLine(doc, pt(mmToUm(x1), mmToUm(y1)), pt(mmToUm(x2), mmToUm(y2))));
  };
  L(0, 0, 100.5, 0); L(100.5, 0, 100.5, 60.25); L(100.5, 60.25, 0, 60.25); L(0, 60.25, 0, 0);
  doc.entities.push(mkCircle(doc, pt(mmToUm(25.125), mmToUm(30.5)), mmToUm(8.75)));
  doc.entities.push({
    ...mkCircle(doc, pt(mmToUm(75.875), mmToUm(30.5)), mmToUm(8.75)),
  });
  doc.entities.push({
    ...mkLine(doc, pt(0, 0), pt(0, 0)), type: 'polyline',
    verts: [
      { x: mmToUm(10), y: mmToUm(10), bulge: 0 },
      { x: mmToUm(40), y: mmToUm(10), bulge: 414214 },
      { x: mmToUm(40), y: mmToUm(25), bulge: 0 },
    ],
    closed: false,
  } as unknown as CadDocument['entities'][number]);
  return doc;
}

export function runAcceptanceTests(): TestResult[] {
  results.length = 0;
  results.push(check('① 100mmの線を10本つなげて合計1000.000mm', testChain100));
  results.push(check('② 12345.678mm移動して戻すと座標が完全一致', testMoveRoundTrip));
  results.push(check('③ 90度回転4回で完全に元通り', testRotate4));
  results.push(check('④ DXF(2013)書出→読込を5回で座標不変', () => testDxfRoundTrip5('2013')));
  results.push(check('④\' DXF(R12)書出→読込を5回で座標不変', () => testDxfRoundTrip5('R12')));
  results.push(check('⑤ 円と直線の交点が本当に円上にある', testIntersectionOnCircle));
  results.push(check('⑥ 100回連続でUndoできる', testUndo100));
  results.push(check('⑦ 拘束した長方形の寸法変更に形が追従', testConstraintRectangle));
  results.push(check('⑧ 拘束200個換算で0.1秒以内に解ける', testSolverPerformance));
  results.push(check('⑨ .xcad 保存→読込で座標が不変', testXcadRoundTrip));
  return [...results];
}

export { UM_PER_MM };
