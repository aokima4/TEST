/** 図面枠と表題欄（仕様 6-4）、部品表（6-5） */
import type { CadDocument, Entity, SheetDef, InsertEnt } from '../model/types.js';
import { UM_PER_MM } from '../core/units.js';
import { PAPER_MM } from '../io/pdf.js';

const mm = (v: number): number => Math.round(v * UM_PER_MM);

let seq = 0;
function ent<T extends Partial<Entity>>(o: T): Entity {
  return {
    id: `frame${++seq}`, layer: '図面枠', color: null, linetype: null, lineweightUm: null,
    created: 0, updated: 0, ...o,
  } as Entity;
}
const line = (x1: number, y1: number, x2: number, y2: number, lw?: number): Entity =>
  ent({ type: 'line', x1, y1, x2, y2, lineweightUm: lw ?? null });
const txt = (x: number, y: number, text: string, h: number, halign: 'left' | 'center' | 'right' = 'left'): Entity =>
  ent({ type: 'text', x, y, text, h, rot: 0, font: 'sans-serif', halign, valign: 'middle' });

/** 文字幅の概算（全角は1文字＝文字高さ、半角は0.6倍） */
function textWidth(s: string, h: number): number {
  let w = 0;
  for (const ch of s) w += /[\x20-\x7e]/.test(ch) ? h * 0.6 : h;
  return w;
}

/** 枠内に収まるよう文字高さを縮める（表題欄からはみ出さないため） */
function fitHeight(s: string, h: number, maxWidth: number): number {
  if (!s) return h;
  const w = textWidth(s, h);
  return w <= maxWidth ? h : Math.max(h * 0.4, (h * maxWidth) / w);
}

export interface FrameInfo {
  entities: Entity[];
  /** 用紙の外形（図面座標） */
  paper: { x1: number; y1: number; x2: number; y2: number };
  /** 作図可能領域 */
  inner: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * 図面枠を生成する。用紙サイズは紙面mm、図面座標へは尺度分だけ拡大して置く。
 * （尺度1:2なら、A3の枠は図面上では 594×420mm の範囲を覆う）
 */
export function buildFrame(sheet: SheetDef): FrameInfo {
  seq = 0;
  const [shortMm, longMm] = PAPER_MM[sheet.size] ?? PAPER_MM.A3;
  const wMm = sheet.landscape ? longMm : shortMm;
  const hMm = sheet.landscape ? shortMm : longMm;
  const k = sheet.scaleDen / sheet.scaleNum;    // 図面mm / 紙面mm

  const W = mm(wMm * k), H = mm(hMm * k);
  const marginL = mm(20 * k), margin = mm(10 * k);
  const out: Entity[] = [];

  // 用紙外形（細線）
  out.push(
    line(0, 0, W, 0, 250), line(W, 0, W, H, 250), line(W, H, 0, H, 250), line(0, H, 0, 0, 250),
  );
  // 輪郭線（太線）
  const x1 = marginL, y1 = margin, x2 = W - margin, y2 = H - margin;
  out.push(
    line(x1, y1, x2, y1, 700), line(x2, y1, x2, y2, 700), line(x2, y2, x1, y2, 700), line(x1, y2, x1, y1, 700),
  );

  // 中心マーク
  const cm = mm(5 * k);
  out.push(
    line((x1 + x2) / 2, y1 - cm, (x1 + x2) / 2, y1 + cm, 700),
    line((x1 + x2) / 2, y2 - cm, (x1 + x2) / 2, y2 + cm, 700),
    line(x1 - cm, (y1 + y2) / 2, x1 + cm, (y1 + y2) / 2, 700),
    line(x2 - cm, (y1 + y2) / 2, x2 + cm, (y1 + y2) / 2, 700),
  );

  // 表題欄（右下、180×56mm）
  const tw = mm(180 * k), thh = mm(56 * k);
  const tx = x2 - tw, ty = y1;
  const rows = [0, 8, 16, 24, 32, 40, 48, 56].map((v) => ty + mm(v * k));
  out.push(line(tx, ty, tx, ty + thh, 700), line(tx, ty + thh, x2, ty + thh, 700));
  const colX = [0, 30, 90, 120, 180].map((v) => tx + mm(v * k));
  // 上2段の右側は会社名欄として結合するため、区切り線を引かない
  rows.slice(1, -1).forEach((r, i) => {
    const idx = i + 1;
    out.push(line(tx, r, idx <= 4 ? x2 : colX[2], r, 250));
  });
  out.push(line(colX[1], ty, colX[1], ty + thh, 250));
  out.push(line(colX[2], ty, colX[2], ty + thh, 250));
  out.push(line(colX[3], ty, colX[3], rows[5], 250));

  const t = sheet.title;
  const fs = mm(3.5 * k), fsB = mm(5 * k);
  const cell = (col: number, row: number, label: string, value: string): void => {
    const cx = colX[col] + mm(2 * k);
    const cy = (rows[row] + rows[row + 1]) / 2;
    const right = colX[Math.min(col + 2, colX.length - 1)];
    if (label) out.push(txt(cx, cy, label, mm(2.5 * k)));
    if (value) {
      const vx = cx + (label ? mm(22 * k) : 0);
      out.push(txt(vx, cy, value, fitHeight(value, fs, right - vx - mm(2 * k))));
    }
  };
  // 下段から上へ
  cell(0, 0, '図番', t.drawingNo);
  cell(0, 1, '部品名', t.partName);
  cell(0, 2, '材質', t.material);
  cell(0, 3, '尺度', `${sheet.scaleNum}:${sheet.scaleDen}`);
  cell(0, 4, '投影法', t.projection);
  cell(0, 5, '作成者', t.author);
  cell(0, 6, '日付', t.date);
  cell(2, 0, '改訂', t.revision);
  cell(2, 1, '用紙', `${sheet.size}${sheet.landscape ? '横' : '縦'}`);
  cell(2, 2, '単位', 'mm');
  if (t.company) {
    const cx = colX[2] + mm(2 * k);
    const maxW = x2 - cx - mm(2 * k);
    out.push(txt(cx, (rows[5] + rows[7]) / 2, t.company, fitHeight(t.company, fsB, maxW)));
  }

  return {
    entities: out,
    paper: { x1: 0, y1: 0, x2: W, y2: H },
    inner: { x1, y1, x2, y2 },
  };
}

// ------------------------------------------------------------------ 部品表

export interface BomRow { partNo: string; name: string; material: string; qty: number; note: string }

export function buildBom(doc: CadDocument): BomRow[] {
  const map = new Map<string, BomRow>();
  const walk = (ents: Entity[]): void => {
    for (const e of ents) {
      if (e.type !== 'insert') continue;
      const ins = e as InsertEnt;
      const b = doc.blocks[ins.block];
      const key = ins.block;
      const row = map.get(key) ?? {
        partNo: b?.attrs.partNo ?? '', name: b?.attrs.name ?? ins.block,
        material: b?.attrs.material ?? '', qty: 0, note: b?.attrs.note ?? '',
      };
      row.qty++;
      map.set(key, row);
    }
  };
  walk(doc.entities);
  const rows = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  rows.forEach((r, i) => { if (!r.partNo) r.partNo = String(i + 1); });
  return rows;
}

export function bomToCsv(rows: BomRow[]): string {
  const esc = (s: string): string => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = ['部品番号', '名称', '材質', '員数', '備考'];
  const lines = [head.join(',')];
  for (const r of rows) lines.push([esc(r.partNo), esc(r.name), esc(r.material), String(r.qty), esc(r.note)].join(','));
  // Excel で文字化けしないよう BOM 付き
  return '﻿' + lines.join('\r\n') + '\r\n';
}
