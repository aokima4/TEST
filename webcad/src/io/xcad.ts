/**
 * 標準保存形式 .xcad（仕様 3-4）
 * 中身は JSON。座標は整数µmのまま保存し、小数は一切書き出さない。
 * ブラウザが対応していれば gzip 圧縮して保存し、読み込み時に自動判別する。
 */
import type { CadDocument } from '../model/types.js';
import { FILE_VERSION, emptyDocument } from '../model/types.js';

export interface XcadHeader {
  format: 'xcad';
  fileVersion: number;
  unit: 'micrometer';
  angleUnit: 'microdegree';
  app: string;
  savedAt: string;
}

export function toJson(doc: CadDocument): string {
  const header: XcadHeader = {
    format: 'xcad',
    fileVersion: FILE_VERSION,
    unit: 'micrometer',
    angleUnit: 'microdegree',
    app: 'WebCAD 2D',
    savedAt: new Date().toISOString(),
  };
  const payload = { ...header, document: { ...doc, fileVersion: FILE_VERSION } };
  const text = JSON.stringify(payload, null, 1);
  assertNoFloatCoords(doc);
  return text;
}

/** 保存前の不変条件チェック：座標に小数が混ざっていないこと */
export function assertNoFloatCoords(doc: CadDocument): void {
  const bad: string[] = [];
  const chk = (id: string, k: string, v: number): void => {
    if (!Number.isInteger(v)) bad.push(`${id}.${k}=${v}`);
  };
  for (const e of doc.entities) {
    switch (e.type) {
      case 'line': chk(e.id, 'x1', e.x1); chk(e.id, 'y1', e.y1); chk(e.id, 'x2', e.x2); chk(e.id, 'y2', e.y2); break;
      case 'circle': chk(e.id, 'cx', e.cx); chk(e.id, 'cy', e.cy); chk(e.id, 'r', e.r); break;
      case 'arc': chk(e.id, 'cx', e.cx); chk(e.id, 'cy', e.cy); chk(e.id, 'r', e.r); chk(e.id, 'a1', e.a1); chk(e.id, 'a2', e.a2); break;
      case 'polyline': e.verts.forEach((v, i) => { chk(e.id, `v${i}.x`, v.x); chk(e.id, `v${i}.y`, v.y); chk(e.id, `v${i}.bulge`, v.bulge); }); break;
      case 'text': chk(e.id, 'x', e.x); chk(e.id, 'y', e.y); chk(e.id, 'h', e.h); break;
      case 'point': chk(e.id, 'x', e.x); chk(e.id, 'y', e.y); break;
      default: break;
    }
  }
  if (bad.length) throw new Error(`座標に小数が混入しています（保存を中止）: ${bad.slice(0, 5).join(', ')}`);
}

export function fromJson(text: string): CadDocument {
  const data = JSON.parse(text) as { document?: CadDocument } & Partial<CadDocument>;
  const doc = (data.document ?? (data as CadDocument));
  if (!doc || !Array.isArray(doc.entities)) throw new Error('この .xcad ファイルは読み込めません（形式が違います）');
  const base = emptyDocument(doc.name ?? '無題');
  const merged: CadDocument = {
    ...base, ...doc,
    layers: doc.layers?.length ? doc.layers : base.layers,
    blocks: doc.blocks ?? {},
    constraints: doc.constraints ?? [],
    variables: doc.variables ?? [],
    sheet: { ...base.sheet, ...(doc.sheet ?? {}) },
  };
  if ((merged.fileVersion ?? 1) > FILE_VERSION) {
    throw new Error(`このファイルは新しい版(${merged.fileVersion})です。アプリを更新してください。`);
  }
  return merged;
}

const GZIP_AVAILABLE = typeof CompressionStream !== 'undefined';

export async function saveBlob(doc: CadDocument): Promise<Blob> {
  const text = toJson(doc);
  if (!GZIP_AVAILABLE) return new Blob([text], { type: 'application/json' });
  const cs = new CompressionStream('gzip');
  const stream = new Blob([text]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Blob([buf], { type: 'application/gzip' });
}

export async function loadBlob(file: Blob): Promise<CadDocument> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 2));
  if (head[0] === 0x1f && head[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('圧縮ファイルを展開できないブラウザです');
    const ds = new DecompressionStream('gzip');
    const text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
    return fromJson(text);
  }
  return fromJson(new TextDecoder().decode(buf));
}
