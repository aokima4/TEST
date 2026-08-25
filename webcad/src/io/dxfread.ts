/**
 * DXF 読み込み（仕様 7-1：R12〜2018 ASCII）。
 * mm を µm 整数へ丸めて取り込むため、書き出し→読み込みの往復で座標は不変。
 */
import type { CadDocument, Entity, Layer, LineTypeName, BlockDef, HAlign, VAlign } from '../model/types.js';
import { emptyDocument } from '../model/types.js';
import { mmToUm, degToUDeg, q, qAngle, UDEG_PER_DEG } from '../core/units.js';
import { aciToHex, trueColorToHex } from './aci.js';

interface Pair { code: number; value: string }

function tokenize(src: string): Pair[] {
  const lines = src.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const c = Number(lines[i].trim());
    if (!Number.isFinite(c)) continue;
    out.push({ code: c, value: lines[i + 1] });
  }
  return out;
}

interface RawEnt { type: string; g: Map<number, string[]>; ordered: Pair[] }

function getNum(e: RawEnt, code: number, def = 0): number {
  const v = e.g.get(code)?.[0];
  const n = v === undefined ? NaN : Number(v.trim());
  return Number.isFinite(n) ? n : def;
}
function getStr(e: RawEnt, code: number, def = ''): string {
  return e.g.get(code)?.[0] ?? def;
}
function getAll(e: RawEnt, code: number): string[] { return e.g.get(code) ?? []; }

export interface DxfReadResult {
  doc: CadDocument;
  warnings: string[];
  stats: Record<string, number>;
}

export function readDxf(src: string, name = '読み込み図面'): DxfReadResult {
  const toks = tokenize(src);
  const doc = emptyDocument(name);
  doc.layers = [];
  const warnings: string[] = [];
  const stats: Record<string, number> = {};
  const layerLtype = new Map<string, LineTypeName>();

  let i = 0;
  const readEntityBlock = (stopTypes: string[]): { ents: RawEnt[]; endedWith: string } => {
    const ents: RawEnt[] = [];
    let cur: RawEnt | null = null;
    while (i < toks.length) {
      const t = toks[i];
      if (t.code === 0) {
        const type = t.value.trim().toUpperCase();
        if (stopTypes.includes(type)) { if (cur) ents.push(cur); return { ents, endedWith: type }; }
        if (cur) ents.push(cur);
        cur = { type, g: new Map(), ordered: [] };
        i++;
        continue;
      }
      if (cur) {
        const arr = cur.g.get(t.code);
        if (arr) arr.push(t.value); else cur.g.set(t.code, [t.value]);
        // 頂点順が意味を持つ LWPOLYLINE だけ、出現順も保存する
        if (cur.type === 'LWPOLYLINE') cur.ordered.push(t);
      }
      i++;
    }
    if (cur) ents.push(cur);
    return { ents, endedWith: 'EOF' };
  };

  // セクションを走査
  while (i < toks.length) {
    const t = toks[i];
    if (t.code === 0 && t.value.trim().toUpperCase() === 'SECTION') {
      i++;
      const nameTok = toks[i];
      const sec = (nameTok?.value ?? '').trim().toUpperCase();
      i++;
      if (sec === 'TABLES') {
        const { ents } = readEntityBlock(['ENDSEC']);
        for (const e of ents) {
          if (e.type === 'LAYER') {
            const lname = getStr(e, 2, '0');
            if (!lname || doc.layers.some((l) => l.name === lname)) continue;
            const aci = getNum(e, 62, 7);
            const tc = e.g.has(420) ? trueColorToHex(getNum(e, 420, 0)) : aciToHex(Math.abs(aci) || 7);
            const lt = normalizeLtype(getStr(e, 6, 'CONTINUOUS'));
            layerLtype.set(lname, lt);
            doc.layers.push({
              name: lname, color: tc, linetype: lt,
              lineweightUm: Math.max(0, getNum(e, 370, 25)) * 10 || 250,
              visible: aci >= 0, locked: (getNum(e, 70, 0) & 4) !== 0,
              printable: getNum(e, 290, 1) !== 0,
            });
          }
        }
      } else if (sec === 'BLOCKS') {
        const { ents } = readEntityBlock(['ENDSEC']);
        let cur: BlockDef | null = null;
        for (let bi = 0; bi < ents.length; bi++) {
          const e = ents[bi];
          if (e.type === 'BLOCK') {
            const bname = getStr(e, 2, '');
            cur = { name: bname, baseX: mmToUm(getNum(e, 10, 0)), baseY: mmToUm(getNum(e, 20, 0)), entities: [], attrs: {} };
            if (bname && !/^\*/.test(bname)) doc.blocks[bname] = cur;
            continue;
          }
          if (e.type === 'ENDBLK') { cur = null; continue; }
          if (!cur) continue;
          const conv = convert(e, doc, ents, warnings, bi + 1);
          for (const c of conv) cur.entities.push(c);
        }
      } else if (sec === 'ENTITIES') {
        const { ents } = readEntityBlock(['ENDSEC']);
        for (let k = 0; k < ents.length; k++) {
          const e = ents[k];
          if (e.type === 'VERTEX' || e.type === 'SEQEND' || e.type === 'ATTRIB') continue;
          const conv = convert(e, doc, ents, warnings, k + 1);
          for (const c of conv) {
            doc.entities.push(c);
            stats[c.type] = (stats[c.type] ?? 0) + 1;
          }
        }
      } else {
        readEntityBlock(['ENDSEC']);
      }
      continue;
    }
    i++;
  }

  if (!doc.layers.length) {
    doc.layers = [{ name: '0', color: '#e8e8e8', linetype: 'CONTINUOUS', lineweightUm: 250, visible: true, locked: false, printable: true }];
  }
  // 図形が参照するレイヤが未定義なら追加
  const known = new Set(doc.layers.map((l) => l.name));
  for (const e of doc.entities) {
    if (!known.has(e.layer)) {
      known.add(e.layer);
      doc.layers.push({ name: e.layer, color: '#e8e8e8', linetype: 'CONTINUOUS', lineweightUm: 250, visible: true, locked: false, printable: true });
    }
  }
  doc.currentLayer = doc.layers[0].name;
  doc.nextId = doc.entities.length + 1000;
  return { doc, warnings, stats };
}

function normalizeLtype(s: string): LineTypeName {
  const u = s.trim().toUpperCase();
  if (u.includes('HIDDEN') || u.includes('DASHED')) return 'HIDDEN';
  if (u.includes('PHANTOM')) return 'PHANTOM';
  if (u.includes('CENTER') || u.includes('DASHDOT')) return 'CENTER';
  return 'CONTINUOUS';
}

let idc = 0;
function nid(): string { return `dxf${++idc}`; }

function commonOf(e: RawEnt): Omit<Entity, 'type'> extends never ? never : {
  id: string; layer: string; color: string | null; linetype: LineTypeName | null;
  lineweightUm: number | null; created: number; updated: number;
} {
  const aci = e.g.has(62) ? getNum(e, 62, 256) : 256;
  const color = e.g.has(420) ? trueColorToHex(getNum(e, 420, 0)) : (aci === 256 || aci === 0 ? null : aciToHex(Math.abs(aci)));
  const lw = e.g.has(370) ? getNum(e, 370, -1) : -1;
  const now = Date.now();
  return {
    id: nid(),
    layer: getStr(e, 8, '0'),
    color,
    linetype: e.g.has(6) ? normalizeLtype(getStr(e, 6)) : null,
    lineweightUm: lw > 0 ? lw * 10 : null,
    created: now, updated: now,
  };
}

function convert(e: RawEnt, doc: CadDocument, following: RawEnt[], warnings: string[], from = 0): Entity[] {
  const c = commonOf(e);
  switch (e.type) {
    case 'LINE':
      return [{ ...c, type: 'line', x1: mmToUm(getNum(e, 10)), y1: mmToUm(getNum(e, 20)), x2: mmToUm(getNum(e, 11)), y2: mmToUm(getNum(e, 21)) }];
    case 'CIRCLE':
      return [{ ...c, type: 'circle', cx: mmToUm(getNum(e, 10)), cy: mmToUm(getNum(e, 20)), r: mmToUm(getNum(e, 40)) }];
    case 'ARC':
      return [{
        ...c, type: 'arc', cx: mmToUm(getNum(e, 10)), cy: mmToUm(getNum(e, 20)), r: mmToUm(getNum(e, 40)),
        a1: degToUDeg(getNum(e, 50)), a2: degToUDeg(getNum(e, 51)),
      }];
    case 'POINT':
      return [{ ...c, type: 'point', x: mmToUm(getNum(e, 10)), y: mmToUm(getNum(e, 20)) }];
    case 'LWPOLYLINE': {
      // 42(バルジ)は直前の頂点に属する。出現順を保った走査で正確に対応付ける。
      const verts: { x: number; y: number; bulge: number }[] = [];
      let pending: { x: number; y: number; bulge: number } | null = null;
      for (const t of e.ordered) {
        if (t.code === 10) { if (pending) verts.push(pending); pending = { x: mmToUm(Number(t.value)), y: 0, bulge: 0 }; }
        else if (t.code === 20 && pending) pending.y = mmToUm(Number(t.value));
        else if (t.code === 42 && pending) pending.bulge = Math.round(Number(t.value) * 1e6);
      }
      if (pending) verts.push(pending);
      if (!verts.length) return [];
      return [{ ...c, type: 'polyline', verts, closed: (getNum(e, 70, 0) & 1) !== 0 }];
    }
    case 'POLYLINE': {
      const verts: { x: number; y: number; bulge: number }[] = [];
      for (let k = from; k < following.length; k++) {
        const f = following[k];
        if (f.type === 'VERTEX') {
          verts.push({ x: mmToUm(getNum(f, 10)), y: mmToUm(getNum(f, 20)), bulge: Math.round(getNum(f, 42, 0) * 1e6) });
        } else if (f.type === 'SEQEND') break;
        else break;
      }
      if (!verts.length) return [];
      return [{ ...c, type: 'polyline', verts, closed: (getNum(e, 70, 0) & 1) !== 0 }];
    }
    case 'TEXT': case 'MTEXT': {
      const raw = e.type === 'MTEXT' ? getAll(e, 3).join('') + getStr(e, 1, '') : getStr(e, 1, '');
      const text = cleanMText(raw);
      const ha = getNum(e, 72, 0), va = getNum(e, 73, 0);
      const useAlign = ha !== 0 || va !== 0;
      const halign: HAlign = ha === 1 ? 'center' : ha === 2 ? 'right' : 'left';
      const valign: VAlign = va === 1 ? 'bottom' : va === 2 ? 'middle' : va === 3 ? 'top' : 'base';
      const x = useAlign && e.g.has(11) ? getNum(e, 11) : getNum(e, 10);
      const y = useAlign && e.g.has(21) ? getNum(e, 21) : getNum(e, 20);
      const h = e.type === 'MTEXT' ? getNum(e, 40, 3.5) : getNum(e, 40, 3.5);
      const rot = e.type === 'MTEXT' ? getNum(e, 50, 0) : getNum(e, 50, 0);
      return [{
        ...c, type: 'text', x: mmToUm(x), y: mmToUm(y), text, h: mmToUm(h), rot: degToUDeg(rot),
        font: 'sans-serif', halign, valign,
      }];
    }
    case 'INSERT':
      return [{
        ...c, type: 'insert', block: getStr(e, 2, ''), x: mmToUm(getNum(e, 10)), y: mmToUm(getNum(e, 20)),
        sx: Math.round(getNum(e, 41, 1) * 1e6), sy: Math.round(getNum(e, 42, 1) * 1e6), rot: degToUDeg(getNum(e, 50, 0)),
      }];
    case 'ELLIPSE': {
      const a1 = (getNum(e, 41, 0) * 180) / Math.PI;
      const a2 = (getNum(e, 42, Math.PI * 2) * 180) / Math.PI;
      return [{
        ...c, type: 'ellipse', cx: mmToUm(getNum(e, 10)), cy: mmToUm(getNum(e, 20)),
        majX: mmToUm(getNum(e, 11)), majY: mmToUm(getNum(e, 21)),
        ratio: Math.round(getNum(e, 40, 1) * 1e6), a1: degToUDeg(a1), a2: qAngle(degToUDeg(a2) || 360 * UDEG_PER_DEG),
      }];
    }
    case 'SOLID': case 'TRACE': {
      const pts = [[10, 20], [11, 21], [13, 23], [12, 22]].map(([cx, cy]) => ({ x: mmToUm(getNum(e, cx)), y: mmToUm(getNum(e, cy)) }));
      const uniq = pts.filter((p, k) => k === 0 || p.x !== pts[k - 1].x || p.y !== pts[k - 1].y);
      return [{ ...c, type: 'polyline', verts: uniq.map((p) => ({ ...p, bulge: 0 })), closed: true }];
    }
    case 'DIMENSION': {
      // 寸法は関連ブロックの図形として取り込む（見た目を完全に保つ）
      const bname = getStr(e, 2, '');
      if (bname && doc.blocks[bname]) {
        return [{ ...c, type: 'insert', block: bname, x: 0, y: 0, sx: 1e6, sy: 1e6, rot: 0 }];
      }
      warnings.push('寸法(DIMENSION)を図形として取り込めませんでした: ' + bname);
      return [];
    }
    case 'SPLINE': {
      const xs = getAll(e, 10).map(Number), ys = getAll(e, 20).map(Number);
      if (xs.length < 2) return [];
      warnings.push('スプラインは折れ線として取り込みました');
      return [{
        ...c, type: 'polyline',
        verts: xs.map((x, k) => ({ x: mmToUm(x), y: mmToUm(ys[k] ?? 0), bulge: 0 })),
        closed: (getNum(e, 70, 0) & 1) !== 0,
      }];
    }
    case 'HATCH': return [];   // 境界の再構成は未対応（図形自体は境界線として別途存在する）
    default:
      return [];
  }
}

function cleanMText(s: string): string {
  return s
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

export { q };
