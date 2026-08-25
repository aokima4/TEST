/** 図形・図面データのモデル定義（仕様 第3章）。座標はすべて整数µm。 */
import type { Pt } from '../core/geom.js';

export type LineTypeName = 'CONTINUOUS' | 'HIDDEN' | 'CENTER' | 'PHANTOM';

/** JIS推奨線幅(mm)。内部はµm整数で保持。 */
export const LINEWEIGHTS_UM = [130, 180, 250, 350, 500, 700, 1000] as const;

export interface Layer {
  name: string;
  color: string;          // '#rrggbb'
  linetype: LineTypeName;
  lineweightUm: number;   // µm
  visible: boolean;
  locked: boolean;
  printable: boolean;
}

/** 共通プロパティ。null は「レイヤに従う(ByLayer)」を意味する（仕様 3-2）。 */
export interface EntityCommon {
  id: string;
  layer: string;
  color: string | null;
  linetype: LineTypeName | null;
  lineweightUm: number | null;
  created: number;   // epoch ms
  updated: number;
}

export interface LineEnt extends EntityCommon { type: 'line'; x1: number; y1: number; x2: number; y2: number }
export interface CircleEnt extends EntityCommon { type: 'circle'; cx: number; cy: number; r: number }
/** 円弧は常に a1→a2 を反時計回りに進むものとして保持（DXF準拠） */
export interface ArcEnt extends EntityCommon { type: 'arc'; cx: number; cy: number; r: number; a1: number; a2: number }
export interface PolyVert { x: number; y: number; bulge: number } // bulge は 1e-6 単位の整数
export interface PolylineEnt extends EntityCommon { type: 'polyline'; verts: PolyVert[]; closed: boolean }
export type HAlign = 'left' | 'center' | 'right';
export type VAlign = 'base' | 'bottom' | 'middle' | 'top';
export interface TextEnt extends EntityCommon {
  type: 'text'; x: number; y: number; text: string; h: number; rot: number;
  font: string; halign: HAlign; valign: VAlign;
}
export interface PointEnt extends EntityCommon { type: 'point'; x: number; y: number }
export interface EllipseEnt extends EntityCommon {
  type: 'ellipse'; cx: number; cy: number; majX: number; majY: number;
  ratio: number; /* 1e-6単位 */ a1: number; a2: number;
}
export interface InsertEnt extends EntityCommon {
  type: 'insert'; block: string; x: number; y: number;
  sx: number; sy: number; /* 1e-6単位のスケール */ rot: number;
}
export interface HatchEnt extends EntityCommon {
  type: 'hatch'; boundary: string[]; pattern: string; angle: number; spacing: number;
}

export type DimKind =
  | 'linear-h' | 'linear-v' | 'aligned' | 'radius' | 'diameter' | 'angular' | 'arclen' | 'ordinate';

export interface Tolerance {
  mode: 'none' | 'sym' | 'dev' | 'fit' | 'basic';
  sym?: number;            // ±値 µm
  upper?: number;          // µm
  lower?: number;          // µm
  fit?: string;            // 'H7' など
}

export interface DimEnt extends EntityCommon {
  type: 'dim';
  kind: DimKind;
  /** 計測点（用途は kind による）。p1,p2 = 計測対象、p3 = 寸法線位置 */
  p1: Pt; p2: Pt; p3: Pt; p4?: Pt;
  /** 関連付けた図形ID（変形時に追従させる） */
  refs: string[];
  /** 計測点の関連付け。図形が変わると p1/p2 を自動で作り直す（仕様 6-1） */
  attach1?: Handle | null;
  attach2?: Handle | null;
  textOverride: string | null;
  tol: Tolerance;
  /** 寸法文字高さ µm */
  th: number;
  /** 矢印サイズ µm */
  arrow: number;
  /** 測定値のプレフィックス（φ など） */
  prefix: string;
}

/** 幾何公差（GD&T）の記号枠 — 仕様 6-2【必須】 */
export type GtolSymbol =
  | 'straight' | 'flat' | 'round' | 'cylindrical' | 'lineProfile' | 'surfProfile'
  | 'parallel' | 'perpendicular' | 'angular' | 'position' | 'concentric' | 'symmetric'
  | 'runout' | 'totalRunout';

export interface GtolEnt extends EntityCommon {
  type: 'gtol';
  x: number; y: number;
  h: number;                 // 文字高さ µm
  symbol: GtolSymbol;
  /** 公差値の文字（例 "0.05" / "φ0.1 M"） */
  tolerance: string;
  /** データム（例 ['A','B']） */
  datums: string[];
  /** 引出線の先端（省略可） */
  leader?: Pt | null;
}

/** 引出線付きコメント — 仕様 6-3【推奨】 */
export interface LeaderEnt extends EntityCommon {
  type: 'leader';
  from: Pt;                 // 矢印の先端（指し示す位置）
  to: Pt;                   // 文字の位置
  text: string;
  h: number;
  arrow: number;
}

/** 表面粗さ記号 — 仕様 6-3【推奨】 */
export interface SurfEnt extends EntityCommon {
  type: 'surf';
  x: number; y: number;
  h: number;
  /** 'none'=除去加工を問わない, 'remove'=除去加工する, 'noRemove'=除去加工しない */
  kind: 'none' | 'remove' | 'noRemove';
  /** 上側の値（例 Ra1.6） */
  value: string;
  /** 加工方法など補足 */
  note: string;
  rot: number;
}

export type Entity =
  | LineEnt | CircleEnt | ArcEnt | PolylineEnt | TextEnt | PointEnt
  | EllipseEnt | InsertEnt | HatchEnt | DimEnt | GtolEnt | LeaderEnt | SurfEnt;

export type EntityType = Entity['type'];

export interface BlockDef {
  name: string;
  baseX: number;
  baseY: number;
  entities: Entity[];
  /** 部品表用の属性 */
  attrs: { partNo?: string; name?: string; material?: string; note?: string };
}

// -------------------------------------------------------------- 拘束（第4章）

export type GeoConstraintType =
  | 'coincident' | 'horizontal' | 'vertical' | 'parallel' | 'perpendicular'
  | 'tangent' | 'concentric' | 'equal' | 'symmetric' | 'fixed' | 'pointOn';

export type DimConstraintType = 'distance' | 'distanceH' | 'distanceV' | 'radius' | 'diameter' | 'angle';

export type ConstraintType = GeoConstraintType | DimConstraintType;

/** 図形上の点の指定。line なら 0=始点,1=終点、circle/arc なら 0=中心 */
export interface Handle { id: string; part: number }

export interface Constraint {
  id: string;
  type: ConstraintType;
  handles: Handle[];
  /** 寸法拘束の値（距離ならµm、角度ならµdeg） */
  value?: number;
  /** 値を式で決める場合の式（変数を参照可能） */
  expr?: string;
  /** 参照用の名前（式から参照される） */
  name?: string;
  enabled: boolean;
}

// -------------------------------------------------------------- 図面

export interface SheetDef {
  size: 'A0' | 'A1' | 'A2' | 'A3' | 'A4';
  landscape: boolean;
  /** 尺度: 分子/分母（1:2 なら num=1, den=2）。寸法数値は実寸のまま表示する。 */
  scaleNum: number;
  scaleDen: number;
  showFrame: boolean;
  title: {
    drawingNo: string; partName: string; material: string;
    projection: '第三角法' | '第一角法'; author: string; date: string;
    revision: string; company: string;
  };
}

export interface CadDocument {
  /** ファイル仕様バージョン（将来の互換性のため必須） */
  fileVersion: number;
  unit: 'micrometer';
  angleUnit: 'microdegree';
  name: string;
  layers: Layer[];
  currentLayer: string;
  blocks: Record<string, BlockDef>;
  entities: Entity[];
  constraints: Constraint[];
  /** 変数（仕様 4-3）。値は式または数値文字列。 */
  variables: { name: string; expr: string }[];
  sheet: SheetDef;
  nextId: number;
}

export const FILE_VERSION = 1;

export function defaultLayers(): Layer[] {
  return [
    { name: '外形線', color: '#e8e8e8', linetype: 'CONTINUOUS', lineweightUm: 500, visible: true, locked: false, printable: true },
    { name: '中心線', color: '#ff5f5f', linetype: 'CENTER', lineweightUm: 180, visible: true, locked: false, printable: true },
    { name: '寸法', color: '#59d0ff', linetype: 'CONTINUOUS', lineweightUm: 180, visible: true, locked: false, printable: true },
    { name: 'かくれ線', color: '#c9a227', linetype: 'HIDDEN', lineweightUm: 250, visible: true, locked: false, printable: true },
    { name: 'ハッチング', color: '#8a8f98', linetype: 'CONTINUOUS', lineweightUm: 130, visible: true, locked: false, printable: true },
    { name: '補助線', color: '#8a8f98', linetype: 'CONTINUOUS', lineweightUm: 130, visible: true, locked: false, printable: false },
    { name: '図面枠', color: '#e8e8e8', linetype: 'CONTINUOUS', lineweightUm: 700, visible: true, locked: true, printable: true },
  ];
}

export function defaultSheet(): SheetDef {
  return {
    size: 'A3', landscape: true, scaleNum: 1, scaleDen: 1, showFrame: true,
    title: {
      drawingNo: '', partName: '', material: 'SS400', projection: '第三角法',
      author: '', date: '', revision: '', company: '',
    },
  };
}

export function emptyDocument(name = '無題'): CadDocument {
  const layers = defaultLayers();
  return {
    fileVersion: FILE_VERSION,
    unit: 'micrometer',
    angleUnit: 'microdegree',
    name,
    layers,
    currentLayer: layers[0].name,
    blocks: {},
    entities: [],
    constraints: [],
    variables: [],
    sheet: defaultSheet(),
    nextId: 1,
  };
}
