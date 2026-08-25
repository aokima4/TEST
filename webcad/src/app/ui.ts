/** 画面まわり（仕様 第5章）：ツールパレット・プロパティ・レイヤ・拘束・表題欄・部品表 */
import type { App } from './app.js';
import type { CadDocument, Entity, Layer, LineTypeName, Tolerance, DimEnt } from '../model/types.js';
import { LINEWEIGHTS_UM, emptyDocument, defaultSheet } from '../model/types.js';
import { fmtMM, fmtDeg, mmToUm, degToUDeg, UDEG_PER_DEG, q, umToMm } from '../core/units.js';
import { dist, angleOf, polar, onCircle } from '../core/geom.js';
import { SNAP_LABEL } from '../snap/snap.js';
import type { SnapType } from '../snap/snap.js';
import { buildBom, bomToCsv, buildFrame } from '../sheet/frame.js';
import { writeDxf } from '../io/dxfwrite.js';
import { readDxf } from '../io/dxfread.js';
import { writeSvg } from '../io/svg.js';
import { writePdf, PAPER_MM } from '../io/pdf.js';
import { saveBlob, loadBlob } from '../io/xcad.js';
import { localStore } from './storage.js';
import { docBBox } from '../model/doc.js';

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'value') (el as HTMLInputElement).value = String(v);
    else if (k === 'checked') (el as HTMLInputElement).checked = Boolean(v);
    else if (typeof v === 'boolean') { if (v) el.setAttribute(k, ''); }
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

const $ = (sel: string): HTMLElement => document.querySelector(sel) as HTMLElement;

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve(input.files?.[0] ?? null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

// ================================================================= UI 本体

export class UI {
  private app: App;
  private tabs = ['プロパティ', 'レイヤ', '拘束', '変数', '図面', '部品表'] as const;
  private activeTab: typeof this.tabs[number] = 'プロパティ';

  constructor(app: App) {
    this.app = app;
  }

  mount(): void {
    const app = this.app;
    this.buildToolbar();
    this.buildTools();
    this.buildPanel();
    this.buildStatusBar();

    app.on('selection', () => this.refreshPanel());
    app.on('change', () => { this.refreshPanel(); this.refreshTitle(); });
    app.on('solver', () => { if (this.activeTab === '拘束') this.refreshPanel(); this.refreshStatus(); });
    app.on('status', () => this.refreshStatus());
    app.on('prompt', (p: unknown) => this.setPrompt(String(p ?? '')));
    app.on('options', () => this.refreshToggles());
    app.on('command', () => this.refreshTools());
    app.on('docloaded', () => { this.refreshPanel(); this.refreshTitle(); });
    app.on('autosaved', () => { $('#saveState').textContent = `自動保存 ${new Date().toLocaleTimeString('ja-JP')}`; });
    app.on('editEntity', () => { this.activeTab = 'プロパティ'; this.refreshPanel(); });

    this.refreshPanel();
    this.refreshStatus();
    this.refreshTitle();
  }

  // --------------------------------------------------------------- 上部バー

  private buildToolbar(): void {
    const app = this.app;
    const bar = $('#toolbar');
    const btn = (label: string, title: string, fn: () => void): HTMLElement =>
      h('button', { class: 'tb', title, onclick: fn }, label);

    bar.append(
      h('div', { class: 'brand' }, 'WebCAD 2D', h('span', { class: 'brandsub' }, '機械部品・製造用')),
      h('div', { class: 'tbgroup' },
        btn('新規', '新しい図面 (Ctrl+N)', () => this.newDoc()),
        btn('開く', '.xcad ファイルを開く (Ctrl+O)', () => void this.openXcad()),
        btn('保存', '.xcad で保存 (Ctrl+S)', () => void this.saveXcad()),
      ),
      h('div', { class: 'tbgroup' },
        btn('DXF読込', 'DXFを読み込む', () => void this.importDxf()),
        btn('DXF書出', 'DXFで書き出す', () => this.exportDxfDialog()),
      ),
      h('div', { class: 'tbgroup' },
        btn('PDF', 'PDFで出力（尺度1:1保証）', () => this.exportPdf()),
        btn('SVG', 'SVGで出力', () => this.exportSvg()),
        btn('PNG', 'PNG画像で出力', () => this.exportPng()),
        btn('印刷', '印刷する', () => this.print()),
      ),
      h('div', { class: 'tbgroup' },
        btn('元に戻す', '元に戻す (Ctrl+Z)', () => { app.store.undo(); app.runSolver(); }),
        btn('やり直し', 'やり直し (Ctrl+Y)', () => { app.store.redo(); app.runSolver(); }),
      ),
      h('div', { class: 'tbgroup' },
        btn('全体表示', '図面全体を表示 (Ctrl+0)', () => app.zoomExtents()),
        btn('復旧', '自動保存から復旧', () => void this.recover()),
        btn('検証', '精度の自己診断を実行', () => void this.selfTest()),
        btn('サンプル', 'サンプル図面を読み込む', () => void this.loadSample()),
      ),
      h('div', { class: 'spacer' }),
      h('div', { class: 'docinfo' },
        h('input', {
          id: 'docName', class: 'docname', value: app.doc.name,
          onchange: (e: Event) => {
            app.store.tx('図面名の変更', () => { app.store.touchMeta(); app.doc.name = (e.target as HTMLInputElement).value; });
          },
        }),
        h('span', { id: 'saveState', class: 'savestate' }, '未保存'),
      ),
    );
  }

  private refreshTitle(): void {
    const el = document.getElementById('docName') as HTMLInputElement | null;
    if (el && el.value !== this.app.doc.name) el.value = this.app.doc.name;
    const st = document.getElementById('saveState');
    if (st) st.textContent = this.app.store.dirty ? '● 未保存の変更あり' : '保存済み';
  }

  // --------------------------------------------------------------- ツール

  private buildTools(): void {
    const app = this.app;
    const box = $('#tools');
    const groups = ['作図', '編集', '寸法', '拘束', 'その他'] as const;
    for (const g of groups) {
      const items = [...new Set([...app.commands.values()])].filter((c) => c.group === g);
      if (!items.length) continue;
      box.append(h('div', { class: 'toolgroup' }, g));
      const grid = h('div', { class: 'toolgrid' });
      for (const c of items) {
        grid.append(h('button', {
          class: 'tool', 'data-cmd': c.name,
          title: `${c.name}（${c.alias[0]}）— ${c.hint}`,
          onclick: () => app.run(c),
        }, h('span', { class: 'ticon' }, c.icon ?? c.name.slice(0, 2)), h('span', { class: 'tlabel' }, c.name)));
      }
      box.append(grid);
    }
  }

  private refreshTools(): void {
    const cur = this.app.statusText;
    void cur;
    document.querySelectorAll('.tool').forEach((el) => el.classList.remove('active'));
  }

  // --------------------------------------------------------------- 右パネル

  private buildPanel(): void {
    const p = $('#panel');
    const tabs = h('div', { class: 'tabs' });
    for (const t of this.tabs) {
      tabs.append(h('button', {
        class: 'tab', 'data-tab': t,
        onclick: () => { this.activeTab = t; this.refreshPanel(); },
      }, t));
    }
    p.append(tabs, h('div', { class: 'panelbody', id: 'panelBody' }));
  }

  refreshPanel(): void {
    const body = document.getElementById('panelBody');
    if (!body) return;
    document.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-tab') === this.activeTab);
    });
    body.replaceChildren();
    switch (this.activeTab) {
      case 'プロパティ': body.append(this.propertiesPanel()); break;
      case 'レイヤ': body.append(this.layersPanel()); break;
      case '拘束': body.append(this.constraintsPanel()); break;
      case '変数': body.append(this.variablesPanel()); break;
      case '図面': body.append(this.sheetPanel()); break;
      case '部品表': body.append(this.bomPanel()); break;
    }
  }

  // ---- プロパティ

  private numField(label: string, value: number, onSet: (v: number) => void, unit = 'mm'): HTMLElement {
    return h('label', { class: 'field' },
      h('span', {}, label),
      h('input', {
        class: 'num', type: 'text', value: unit === 'mm' ? fmtMM(value, 3) : fmtDeg(value, 3),
        onchange: (e: Event) => {
          const t = (e.target as HTMLInputElement).value;
          const v = this.app.parseNumber(t, unit === 'mm' ? 'mm' : 'deg');
          if (v === null) { this.app.setStatus('数値を入力してください'); this.refreshPanel(); return; }
          onSet(v);
        },
      }),
      h('span', { class: 'unit' }, unit === 'mm' ? 'mm' : '°'),
    );
  }

  private propertiesPanel(): HTMLElement {
    const app = this.app;
    const box = h('div', { class: 'stack' });
    const ids = [...app.selection];
    if (!ids.length) {
      box.append(
        h('p', { class: 'hint' }, '図形を選ぶと、ここで数値を直接編集できます。'),
        h('div', { class: 'kv' },
          h('div', {}, '図形数'), h('div', {}, String(app.doc.entities.length)),
          h('div', {}, '拘束数'), h('div', {}, String(app.doc.constraints.length)),
          h('div', {}, 'レイヤ数'), h('div', {}, String(app.doc.layers.length)),
          h('div', {}, 'ブロック数'), h('div', {}, String(Object.keys(app.doc.blocks).length)),
        ),
      );
      return box;
    }
    if (ids.length > 1) {
      box.append(h('p', { class: 'hint' }, `${ids.length}個の図形を選択中。共通プロパティを変更できます。`));
      box.append(this.commonProps(ids));
      return box;
    }
    const e = app.store.get(ids[0]);
    if (!e) return box;
    box.append(h('div', { class: 'proptitle' }, typeLabel(e), h('span', { class: 'eid' }, e.id)));
    const upd = (ne: Entity): void => {
      app.store.tx('プロパティ変更', () => app.store.update(ne));
      app.runSolver();
      this.refreshPanel();
    };
    switch (e.type) {
      case 'line': {
        const len = dist({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
        const ang = angleOf({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 });
        box.append(
          this.numField('始点 X', e.x1, (v) => upd({ ...e, x1: v })),
          this.numField('始点 Y', e.y1, (v) => upd({ ...e, y1: v })),
          this.numField('終点 X', e.x2, (v) => upd({ ...e, x2: v })),
          this.numField('終点 Y', e.y2, (v) => upd({ ...e, y2: v })),
          this.numField('長さ', q(len), (v) => {
            const p = polar({ x: e.x1, y: e.y1 }, ang, v);
            upd({ ...e, x2: p.x, y2: p.y });
          }),
          this.numField('角度', ang, (v) => {
            const p = polar({ x: e.x1, y: e.y1 }, v, len);
            upd({ ...e, x2: p.x, y2: p.y });
          }, 'deg'),
        );
        break;
      }
      case 'circle':
        box.append(
          this.numField('中心 X', e.cx, (v) => upd({ ...e, cx: v })),
          this.numField('中心 Y', e.cy, (v) => upd({ ...e, cy: v })),
          this.numField('半径', e.r, (v) => upd({ ...e, r: Math.max(1, v) })),
          this.numField('直径', e.r * 2, (v) => upd({ ...e, r: Math.max(1, Math.round(v / 2)) })),
        );
        break;
      case 'arc':
        box.append(
          this.numField('中心 X', e.cx, (v) => upd({ ...e, cx: v })),
          this.numField('中心 Y', e.cy, (v) => upd({ ...e, cy: v })),
          this.numField('半径', e.r, (v) => upd({ ...e, r: Math.max(1, v) })),
          this.numField('開始角', e.a1, (v) => upd({ ...e, a1: v }), 'deg'),
          this.numField('終了角', e.a2, (v) => upd({ ...e, a2: v }), 'deg'),
        );
        break;
      case 'text':
        box.append(
          h('label', { class: 'field' }, h('span', {}, '文字列'),
            h('input', {
              class: 'txt', value: e.text,
              onchange: (ev: Event) => upd({ ...e, text: (ev.target as HTMLInputElement).value }),
            })),
          this.numField('挿入点 X', e.x, (v) => upd({ ...e, x: v })),
          this.numField('挿入点 Y', e.y, (v) => upd({ ...e, y: v })),
          this.numField('文字高さ', e.h, (v) => upd({ ...e, h: Math.max(1, v) })),
          this.numField('回転角', e.rot, (v) => upd({ ...e, rot: v }), 'deg'),
        );
        break;
      case 'polyline':
        box.append(
          h('div', { class: 'kv' },
            h('div', {}, '頂点数'), h('div', {}, String(e.verts.length)),
            h('div', {}, '閉じている'), h('div', {}, e.closed ? 'はい' : 'いいえ'),
          ),
          h('button', {
            class: 'btn', onclick: () => upd({ ...e, closed: !e.closed }),
          }, e.closed ? '開いた図形にする' : '閉じた図形にする'),
        );
        break;
      case 'insert':
        box.append(
          h('div', { class: 'kv' }, h('div', {}, 'ブロック'), h('div', {}, e.block)),
          this.numField('挿入点 X', e.x, (v) => upd({ ...e, x: v })),
          this.numField('挿入点 Y', e.y, (v) => upd({ ...e, y: v })),
          this.numField('回転角', e.rot, (v) => upd({ ...e, rot: v }), 'deg'),
        );
        break;
      case 'dim':
        box.append(...this.dimProps(e, upd));
        break;
      default: break;
    }
    box.append(h('hr', {}), this.commonProps(ids));
    return box;
  }

  private dimProps(e: DimEnt, upd: (ne: Entity) => void): HTMLElement[] {
    const tol = e.tol ?? { mode: 'none' as const };
    const setTol = (t: Tolerance): void => upd({ ...e, tol: t });
    const out: HTMLElement[] = [
      this.numField('寸法文字高さ', e.th, (v) => upd({ ...e, th: Math.max(1, v) })),
      this.numField('矢印サイズ', e.arrow, (v) => upd({ ...e, arrow: Math.max(1, v) })),
      h('label', { class: 'field' }, h('span', {}, '文字の上書き'),
        h('input', {
          class: 'txt', value: e.textOverride ?? '',
          placeholder: '空欄なら実測値',
          onchange: (ev: Event) => {
            const v = (ev.target as HTMLInputElement).value;
            upd({ ...e, textOverride: v === '' ? null : v });
          },
        })),
      h('label', { class: 'field' }, h('span', {}, '公差'),
        h('select', {
          class: 'sel',
          onchange: (ev: Event) => {
            const m = (ev.target as HTMLSelectElement).value as Tolerance['mode'];
            setTol({ mode: m, sym: tol.sym ?? mmToUm(0.1), upper: tol.upper ?? mmToUm(0.2), lower: tol.lower ?? -mmToUm(0.1), fit: tol.fit ?? 'H7' });
          },
        },
          ...([['none', 'なし'], ['sym', '± 対称'], ['dev', '上下非対称'], ['fit', 'はめあい記号'], ['basic', '理論的に正確な寸法']] as [string, string][])
            .map(([v, l]) => h('option', { value: v, selected: tol.mode === v }, l)),
        )),
    ];
    if (tol.mode === 'sym') out.push(this.numField('± 値', tol.sym ?? 0, (v) => setTol({ ...tol, sym: v })));
    if (tol.mode === 'dev') {
      out.push(this.numField('上の許容差', tol.upper ?? 0, (v) => setTol({ ...tol, upper: v })));
      out.push(this.numField('下の許容差', tol.lower ?? 0, (v) => setTol({ ...tol, lower: v })));
    }
    if (tol.mode === 'fit') {
      out.push(h('label', { class: 'field' }, h('span', {}, 'はめあい'),
        h('input', {
          class: 'txt', value: tol.fit ?? 'H7',
          onchange: (ev: Event) => setTol({ ...tol, fit: (ev.target as HTMLInputElement).value }),
        })));
    }
    return out;
  }

  private commonProps(ids: string[]): HTMLElement {
    const app = this.app;
    const first = app.store.get(ids[0]);
    const apply = (fn: (e: Entity) => Entity): void => {
      app.store.tx('プロパティ変更', () => {
        for (const id of ids) {
          const e = app.store.get(id);
          if (e) app.store.update(fn(e));
        }
      });
      this.refreshPanel();
    };
    return h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, 'レイヤ'),
        h('select', {
          class: 'sel',
          onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; apply((x) => ({ ...x, layer: v })); },
        }, ...app.doc.layers.map((l) => h('option', { value: l.name, selected: first?.layer === l.name }, l.name))),
      ),
      h('label', { class: 'field' }, h('span', {}, '色'),
        h('select', {
          class: 'sel',
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            apply((x) => ({ ...x, color: v === 'bylayer' ? null : v }));
          },
        },
          h('option', { value: 'bylayer', selected: first?.color === null }, 'レイヤに従う'),
          ...['#ffffff', '#ff5f5f', '#3ddc84', '#59d0ff', '#ffd24a', '#ff8ad8', '#8a8f98']
            .map((c) => h('option', { value: c, selected: first?.color === c }, c)),
        )),
      h('label', { class: 'field' }, h('span', {}, '線種'),
        h('select', {
          class: 'sel',
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            apply((x) => ({ ...x, linetype: v === 'bylayer' ? null : (v as LineTypeName) }));
          },
        },
          h('option', { value: 'bylayer', selected: first?.linetype === null }, 'レイヤに従う'),
          ...(['CONTINUOUS', 'HIDDEN', 'CENTER', 'PHANTOM'] as LineTypeName[])
            .map((c) => h('option', { value: c, selected: first?.linetype === c }, ltLabel(c))),
        )),
      h('label', { class: 'field' }, h('span', {}, '線幅'),
        h('select', {
          class: 'sel',
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            apply((x) => ({ ...x, lineweightUm: v === 'bylayer' ? null : Number(v) }));
          },
        },
          h('option', { value: 'bylayer', selected: first?.lineweightUm === null }, 'レイヤに従う'),
          ...LINEWEIGHTS_UM.map((w) => h('option', { value: w, selected: first?.lineweightUm === w }, `${(w / 1000).toFixed(2)} mm`)),
        )),
      h('button', { class: 'btn danger', onclick: () => app.deleteSelection() }, '選択図形を削除'),
    );
  }

  // ---- レイヤ

  private layersPanel(): HTMLElement {
    const app = this.app;
    const box = h('div', { class: 'stack' });
    const table = h('div', { class: 'layers' });
    for (const l of app.doc.layers) {
      const set = (fn: (x: Layer) => void): void => {
        app.store.tx('レイヤ変更', () => { app.store.touchMeta(); fn(l); });
        app.invalidate();
        this.refreshPanel();
      };
      table.append(h('div', { class: 'layerrow' + (app.doc.currentLayer === l.name ? ' cur' : '') },
        h('button', { class: 'lbtn', title: '現在のレイヤにする', onclick: () => set(() => { app.doc.currentLayer = l.name; }) }, app.doc.currentLayer === l.name ? '●' : '○'),
        h('button', { class: 'lbtn', title: '表示/非表示', onclick: () => set(() => { l.visible = !l.visible; }) }, l.visible ? '👁' : '–'),
        h('button', { class: 'lbtn', title: 'ロック', onclick: () => set(() => { l.locked = !l.locked; }) }, l.locked ? '🔒' : '🔓'),
        h('input', { type: 'color', class: 'lcolor', value: l.color, onchange: (e: Event) => set(() => { l.color = (e.target as HTMLInputElement).value; }) }),
        h('input', { class: 'lname', value: l.name, onchange: (e: Event) => {
          const nn = (e.target as HTMLInputElement).value.trim();
          if (!nn) return;
          const old = l.name;
          app.store.tx('レイヤ名変更', () => {
            app.store.touchMeta();
            l.name = nn;
            if (app.doc.currentLayer === old) app.doc.currentLayer = nn;
            for (const en of app.doc.entities) if (en.layer === old) app.store.update({ ...en, layer: nn });
          });
          this.refreshPanel();
        } }),
        h('select', { class: 'lsel', onchange: (e: Event) => set(() => { l.linetype = (e.target as HTMLSelectElement).value as LineTypeName; }) },
          ...(['CONTINUOUS', 'HIDDEN', 'CENTER', 'PHANTOM'] as LineTypeName[]).map((t) => h('option', { value: t, selected: l.linetype === t }, ltLabel(t)))),
        h('select', { class: 'lsel', onchange: (e: Event) => set(() => { l.lineweightUm = Number((e.target as HTMLSelectElement).value); }) },
          ...LINEWEIGHTS_UM.map((w) => h('option', { value: w, selected: l.lineweightUm === w }, (w / 1000).toFixed(2)))),
        h('button', { class: 'lbtn danger', title: 'レイヤ削除', onclick: () => {
          if (app.doc.layers.length <= 1) return;
          const used = app.doc.entities.filter((e) => e.layer === l.name).length;
          if (used && !confirm(`レイヤ「${l.name}」の図形 ${used} 個も削除されます。よろしいですか？`)) return;
          app.store.tx('レイヤ削除', () => {
            for (const e of app.doc.entities.filter((e2) => e2.layer === l.name)) app.store.remove(e.id);
            app.store.touchMeta();
            app.doc.layers = app.doc.layers.filter((x) => x.name !== l.name);
            if (app.doc.currentLayer === l.name) app.doc.currentLayer = app.doc.layers[0].name;
          });
          this.refreshPanel();
        } }, '✕'),
      ));
    }
    box.append(table, h('button', {
      class: 'btn', onclick: () => {
        let n = 1;
        while (app.doc.layers.some((l) => l.name === `レイヤ${n}`)) n++;
        app.store.tx('レイヤ追加', () => {
          app.store.touchMeta();
          app.doc.layers.push({ name: `レイヤ${n}`, color: '#e8e8e8', linetype: 'CONTINUOUS', lineweightUm: 250, visible: true, locked: false, printable: true });
        });
        this.refreshPanel();
      },
    }, '＋ レイヤを追加'));
    return box;
  }

  // ---- 拘束

  private constraintsPanel(): HTMLElement {
    const app = this.app;
    const box = h('div', { class: 'stack' });
    const st = app.dofStates;
    const counts = { under: 0, full: 0, over: 0 };
    for (const v of st.values()) counts[v]++;
    box.append(
      h('div', { class: 'dofbar' },
        h('span', { class: 'dof under' }, `未拘束 ${counts.under}`),
        h('span', { class: 'dof full' }, `完全拘束 ${counts.full}`),
        h('span', { class: 'dof over' }, `過拘束 ${counts.over}`),
      ),
      h('p', { class: 'hint' }, app.solverMsg || '拘束はまだありません。左の「拘束」ツールから追加できます。'),
    );
    if (app.conflicts.length) {
      box.append(h('div', { class: 'alert' },
        h('b', {}, '拘束が矛盾しています。'),
        h('div', {}, '下の赤い拘束のどれかを削除してください：'),
      ));
    }
    const list = h('div', { class: 'clist' });
    for (const c of app.doc.constraints) {
      const bad = app.conflicts.includes(c.id);
      list.append(h('div', { class: 'crow' + (bad ? ' bad' : '') },
        h('span', { class: 'ctype' }, constraintLabel(c.type)),
        h('span', { class: 'cval' }, c.expr ? `= ${c.expr}` : c.value !== undefined
          ? (c.type === 'angle' ? `${fmtDeg(c.value, 2)}°` : `${fmtMM(c.value, 3)} mm`) : ''),
        h('span', { class: 'cids' }, c.handles.map((x) => x.id).join(', ')),
        h('button', {
          class: 'lbtn', title: '一時的に無効化',
          onclick: () => {
            app.store.tx('拘束の有効/無効', () => { app.store.touchMeta(); c.enabled = !c.enabled; });
            app.runSolver(); this.refreshPanel();
          },
        }, c.enabled ? '有効' : '無効'),
        h('button', {
          class: 'lbtn danger', title: '削除',
          onclick: () => {
            app.store.tx('拘束削除', () => {
              app.store.touchMeta();
              app.doc.constraints = app.doc.constraints.filter((x) => x.id !== c.id);
            });
            app.runSolver(); this.refreshPanel();
          },
        }, '✕'),
      ));
    }
    box.append(list);
    if (c2Editable(app.doc)) {
      box.append(h('p', { class: 'hint' }, '寸法拘束の値は上の一覧をダブルクリックせず、右の欄で式に変えられます（変数タブ参照）。'));
    }
    return box;
  }

  // ---- 変数

  private variablesPanel(): HTMLElement {
    const app = this.app;
    app.resolveVariables();
    const box = h('div', { class: 'stack' });
    box.append(h('p', { class: 'hint' }, '寸法に名前を付け、他の寸法を式で決められます。例）穴ピッチ = 穴径 * 3'));
    const table = h('div', { class: 'vars' });
    app.doc.variables.forEach((v, i) => {
      const err = app.varErrors[v.name];
      table.append(h('div', { class: 'varrow' + (err ? ' bad' : '') },
        h('input', {
          class: 'vname', value: v.name,
          onchange: (e: Event) => {
            app.store.tx('変数名の変更', () => { app.store.touchMeta(); app.doc.variables[i].name = (e.target as HTMLInputElement).value.trim(); });
            app.runSolver(); this.refreshPanel();
          },
        }),
        h('span', {}, '='),
        h('input', {
          class: 'vexpr', value: v.expr,
          onchange: (e: Event) => {
            app.store.tx('変数式の変更', () => { app.store.touchMeta(); app.doc.variables[i].expr = (e.target as HTMLInputElement).value; });
            app.runSolver(); this.refreshPanel();
          },
        }),
        h('span', { class: 'vval' }, err ? err : `${(app.varValues[v.name] ?? 0).toFixed(3)} mm`),
        h('button', {
          class: 'lbtn danger', onclick: () => {
            app.store.tx('変数削除', () => { app.store.touchMeta(); app.doc.variables.splice(i, 1); });
            app.runSolver(); this.refreshPanel();
          },
        }, '✕'),
      ));
    });
    box.append(table, h('button', {
      class: 'btn', onclick: () => {
        app.store.tx('変数追加', () => {
          app.store.touchMeta();
          let n = 1;
          while (app.doc.variables.some((v) => v.name === `変数${n}`)) n++;
          app.doc.variables.push({ name: `変数${n}`, expr: '10' });
        });
        this.refreshPanel();
      },
    }, '＋ 変数を追加'));
    return box;
  }

  // ---- 図面（用紙・表題欄）

  private sheetPanel(): HTMLElement {
    const app = this.app;
    const s = app.doc.sheet;
    const set = (fn: () => void): void => {
      app.store.tx('図面設定', () => { app.store.touchMeta(); fn(); });
      app.invalidate(); this.refreshPanel();
    };
    const textField = (label: string, value: string, on: (v: string) => void): HTMLElement =>
      h('label', { class: 'field' }, h('span', {}, label),
        h('input', { class: 'txt', value, onchange: (e: Event) => set(() => on((e.target as HTMLInputElement).value)) }));

    return h('div', { class: 'stack' },
      h('label', { class: 'field' }, h('span', {}, '用紙サイズ'),
        h('select', { class: 'sel', onchange: (e: Event) => set(() => { s.size = (e.target as HTMLSelectElement).value as typeof s.size; }) },
          ...Object.keys(PAPER_MM).map((k) => h('option', { value: k, selected: s.size === k }, k)))),
      h('label', { class: 'field' }, h('span', {}, '向き'),
        h('select', { class: 'sel', onchange: (e: Event) => set(() => { s.landscape = (e.target as HTMLSelectElement).value === 'yoko'; }) },
          h('option', { value: 'yoko', selected: s.landscape }, '横'),
          h('option', { value: 'tate', selected: !s.landscape }, '縦'))),
      h('label', { class: 'field' }, h('span', {}, '尺度'),
        h('select', { class: 'sel', onchange: (e: Event) => set(() => {
          const [n, d] = (e.target as HTMLSelectElement).value.split(':').map(Number);
          s.scaleNum = n; s.scaleDen = d;
        }) },
          ...['1:1', '1:2', '1:5', '1:10', '1:20', '1:50', '2:1', '5:1', '10:1']
            .map((v) => h('option', { value: v, selected: `${s.scaleNum}:${s.scaleDen}` === v }, v)))),
      h('label', { class: 'field' }, h('span', {}, '図面枠を表示'),
        h('input', { type: 'checkbox', checked: s.showFrame, onchange: (e: Event) => set(() => { s.showFrame = (e.target as HTMLInputElement).checked; }) })),
      h('hr', {}),
      h('div', { class: 'proptitle' }, '表題欄'),
      textField('図番', s.title.drawingNo, (v) => { s.title.drawingNo = v; }),
      textField('部品名', s.title.partName, (v) => { s.title.partName = v; }),
      textField('材質', s.title.material, (v) => { s.title.material = v; }),
      h('label', { class: 'field' }, h('span', {}, '投影法'),
        h('select', { class: 'sel', onchange: (e: Event) => set(() => { s.title.projection = (e.target as HTMLSelectElement).value as '第三角法' | '第一角法'; }) },
          h('option', { value: '第三角法', selected: s.title.projection === '第三角法' }, '第三角法'),
          h('option', { value: '第一角法', selected: s.title.projection === '第一角法' }, '第一角法'))),
      textField('作成者', s.title.author, (v) => { s.title.author = v; }),
      textField('日付', s.title.date, (v) => { s.title.date = v; }),
      textField('改訂', s.title.revision, (v) => { s.title.revision = v; }),
      textField('会社名', s.title.company, (v) => { s.title.company = v; }),
      h('button', { class: 'btn', onclick: () => set(() => { s.title.date = new Date().toLocaleDateString('ja-JP'); }) }, '日付を今日にする'),
    );
  }

  // ---- 部品表

  private bomPanel(): HTMLElement {
    const rows = buildBom(this.app.doc);
    const box = h('div', { class: 'stack' });
    if (!rows.length) {
      box.append(h('p', { class: 'hint' }, 'ブロックを配置すると、ここに部品表が自動生成されます。'));
      return box;
    }
    const table = h('table', { class: 'bom' },
      h('tr', {}, h('th', {}, '番号'), h('th', {}, '名称'), h('th', {}, '材質'), h('th', {}, '員数')),
      ...rows.map((r) => h('tr', {}, h('td', {}, r.partNo), h('td', {}, r.name), h('td', {}, r.material), h('td', {}, String(r.qty)))),
    );
    box.append(table, h('button', {
      class: 'btn', onclick: () => download(new Blob([bomToCsv(rows)], { type: 'text/csv' }), `${this.app.doc.name}_部品表.csv`),
    }, 'CSVで書き出す'));
    return box;
  }

  // --------------------------------------------------------------- 下部バー

  private buildStatusBar(): void {
    const app = this.app;
    const bar = $('#statusbar');
    const input = h('input', {
      id: 'cmdline', class: 'cmdline', placeholder: 'コマンド（例: L / C / TR）または座標（100,50 ／ @100<45）',
      autocomplete: 'off', spellcheck: false,
    }) as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        app.submitInput(input.value);
        input.value = '';
      } else if (e.key === 'Escape') {
        input.value = '';
        app.cancel();
      }
    });

    const toggle = (id: string, label: string, get: () => boolean, set: (v: boolean) => void, title: string): HTMLElement =>
      h('button', {
        id, class: 'toggle', title,
        onclick: () => { set(!get()); this.refreshToggles(); app.invalidate(); },
      }, label);

    const snapMenu = h('div', { class: 'snapmenu', id: 'snapMenu' });
    const types: SnapType[] = ['endpoint', 'intersection', 'center', 'midpoint', 'quadrant', 'perpendicular', 'tangent', 'extension', 'nearest'];
    for (const t of types) {
      snapMenu.append(h('label', { class: 'snapitem' },
        h('input', {
          type: 'checkbox', checked: app.snap.types[t],
          onchange: (e: Event) => { app.snap.types[t] = (e.target as HTMLInputElement).checked; },
        }),
        SNAP_LABEL[t],
      ));
    }

    bar.append(
      h('div', { class: 'promptline', id: 'prompt' }, 'コマンド：クリックで選択 / 右クリックで中止'),
      input,
      h('div', { class: 'statusgroup' },
        toggle('tgSnap', 'スナップ', () => app.snap.enabled, (v) => { app.snap.enabled = v; }, 'スナップのON/OFF (F3)'),
        h('div', { class: 'snapwrap' }, h('button', { class: 'toggle', onclick: () => snapMenu.classList.toggle('open') }, '▾'), snapMenu),
        toggle('tgGrid', 'グリッド', () => app.options.grid, (v) => { app.options.grid = v; app.snap.gridOn = v; }, 'グリッド表示 (F7)'),
        toggle('tgOrtho', '直交', () => app.options.ortho, (v) => { app.options.ortho = v; }, '直交モード (F8 / Shift)'),
        toggle('tgLw', '線幅', () => app.options.showLineweight, (v) => { app.options.showLineweight = v; }, '線幅表示'),
        toggle('tgDof', '自由度', () => app.options.showDof, (v) => { app.options.showDof = v; }, '拘束の自由度を色で表示'),
        toggle('tgFrame', '図面枠', () => app.options.showFrame, (v) => { app.options.showFrame = v; }, '図面枠の表示'),
      ),
      h('div', { class: 'coords', id: 'coords' }, '—'),
      h('div', { class: 'perf', id: 'perf' }, ''),
    );
    this.refreshToggles();
  }

  private refreshToggles(): void {
    const app = this.app;
    const set = (id: string, on: boolean): void => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('on', on);
    };
    set('tgSnap', app.snap.enabled);
    set('tgGrid', app.options.grid);
    set('tgOrtho', app.options.ortho);
    set('tgLw', app.options.showLineweight);
    set('tgDof', app.options.showDof);
    set('tgFrame', app.options.showFrame);
  }

  setPrompt(text: string): void {
    const el = document.getElementById('prompt');
    if (el) el.textContent = text || 'コマンド：クリックで選択 / 右クリックで中止';
  }

  refreshStatus(): void {
    const app = this.app;
    const c = document.getElementById('coords');
    if (c) {
      const p = app.worldCursor;
      const snapTxt = app.snapHit ? `［${SNAP_LABEL[app.snapHit.type]}］` : '';
      c.textContent = `X ${fmtMM(p.x, 3)}  Y ${fmtMM(p.y, 3)} mm ${snapTxt}`;
    }
    const perf = document.getElementById('perf');
    if (perf) {
      perf.textContent = `${app.fps}fps ／ 表示 ${app.drawnCount}/${app.doc.entities.length} 図形 ／ 描画 ${app.lastRenderMs.toFixed(1)}ms ／ 倍率 ${(app.vp.pxPerMm).toFixed(2)}px/mm`;
    }
    const st = document.getElementById('saveState');
    if (st && !st.textContent?.startsWith('自動保存')) st.textContent = app.store.dirty ? '● 未保存の変更あり' : '保存済み';
    const pr = document.getElementById('prompt');
    if (pr && app.statusText && !app.statusText.startsWith('コマンド')) pr.textContent = app.statusText;
  }

  // --------------------------------------------------------------- ファイル

  private newDoc(): void {
    if (this.app.store.dirty && !confirm('保存していない変更があります。新規作成しますか？')) return;
    this.app.loadDocument(emptyDocument('無題'));
  }

  private async saveXcad(): Promise<void> {
    const blob = await saveBlob(this.app.doc);
    download(blob, `${this.app.doc.name}.xcad`);
    this.app.store.markSaved();
    await this.app.autosave();
    this.refreshTitle();
  }

  private async openXcad(): Promise<void> {
    const f = await pickFile('.xcad,.json');
    if (!f) return;
    try {
      const doc = await loadBlob(f);
      this.app.loadDocument(doc);
      this.app.setStatus(`「${doc.name}」を開きました`);
    } catch (e) {
      alert(`開けませんでした：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async importDxf(): Promise<void> {
    const f = await pickFile('.dxf');
    if (!f) return;
    const text = await f.text();
    const t0 = performance.now();
    const r = readDxf(text, f.name.replace(/\.dxf$/i, ''));
    this.app.loadDocument(r.doc);
    const ms = performance.now() - t0;
    this.app.setStatus(`DXF読込：${r.doc.entities.length}図形 / ${ms.toFixed(0)}ms${r.warnings.length ? ` / 注意 ${r.warnings.length}件` : ''}`);
  }

  private exportDxfDialog(): void {
    const ver = confirm('OK＝2013形式（推奨）／キャンセル＝R12形式') ? '2013' : 'R12';
    const text = writeDxf(this.app.doc, { version: ver as 'R12' | '2013' });
    download(new Blob([text], { type: 'application/dxf' }), `${this.app.doc.name}_${ver}.dxf`);
    this.app.setStatus(`DXF（${ver}）を書き出しました`);
  }

  private plotBBox(): { x1: number; y1: number; x2: number; y2: number } {
    const app = this.app;
    if (app.doc.sheet.showFrame) return buildFrame(app.doc.sheet).paper;
    const b = docBBox(app.doc);
    if (!Number.isFinite(b.x1)) return { x1: 0, y1: 0, x2: 297_000, y2: 210_000 };
    const pad = 10_000;
    return { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad };
  }

  private exportPdf(): void {
    const app = this.app;
    const s = app.doc.sheet;
    const blob = writePdf(app.doc, {
      bbox: this.plotBBox(), paper: s.size, landscape: s.landscape,
      scaleDen: s.scaleDen / s.scaleNum, extra: app.frameEntities(), monochrome: true, title: app.doc.name,
    });
    download(blob, `${app.doc.name}.pdf`);
    app.setStatus('PDFを書き出しました（尺度1:1・ベクター）');
  }

  private exportSvg(): void {
    const app = this.app;
    const svg = writeSvg(app.doc, {
      bbox: this.plotBBox(), scaleDen: app.doc.sheet.scaleDen / app.doc.sheet.scaleNum,
      extra: app.frameEntities(), background: '#ffffff', monochrome: true,
    });
    download(new Blob([svg], { type: 'image/svg+xml' }), `${app.doc.name}.svg`);
  }

  private exportPng(): void {
    const app = this.app;
    const input = prompt('解像度 (dpi)', '300');
    if (!input) return;
    const dpi = Math.max(72, Math.min(1200, Number(input) || 300));
    const b = this.plotBBox();
    const k = app.doc.sheet.scaleNum / app.doc.sheet.scaleDen;
    const wMm = ((b.x2 - b.x1) / 1000) * k, hMm = ((b.y2 - b.y1) / 1000) * k;
    const px = (mm: number): number => Math.round((mm / 25.4) * dpi);
    const cv = document.createElement('canvas');
    cv.width = px(wMm); cv.height = px(hMm);
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // 一時ビューポートで描画
    const { Viewport } = { Viewport: app.vp.constructor as new () => typeof app.vp };
    const vp = new Viewport();
    vp.resize(cv.width, cv.height, 1);
    vp.fit(b, 0);
    import('../render/canvas.js').then(({ renderScene }) => {
      renderScene(ctx, vp, app.doc, app.store.index, {
        grid: { on: false, spacingUm: 0 }, showLineweight: true, selection: new Set(), hover: null,
        dofColors: null, showDof: false, extra: app.frameEntities(), darkTheme: false,
        overrideColor: () => '#000000',
      });
      cv.toBlob((blob) => { if (blob) download(blob, `${app.doc.name}_${dpi}dpi.png`); }, 'image/png');
    }).catch(() => undefined);
  }

  private print(): void {
    const app = this.app;
    const s = app.doc.sheet;
    const [shortMm, longMm] = PAPER_MM[s.size];
    const wMm = s.landscape ? longMm : shortMm;
    const hMm = s.landscape ? shortMm : longMm;
    const svg = writeSvg(app.doc, {
      bbox: this.plotBBox(), scaleDen: s.scaleDen / s.scaleNum,
      extra: app.frameEntities(), background: '#ffffff', monochrome: true,
    });
    const win = window.open('', '_blank');
    if (!win) { alert('ポップアップがブロックされました。印刷を許可してください。'); return; }
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${app.doc.name}</title>
<style>
  @page { size: ${wMm}mm ${hMm}mm; margin: 0; }
  html,body { margin:0; padding:0; }
  svg { display:block; }
</style></head><body>${svg}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  private async recover(): Promise<void> {
    const gens = await localStore.generations(this.app.docKey);
    if (!gens.length) { alert('自動保存されたデータがありません。'); return; }
    const list = gens.slice(0, 30).map((g, i) => `${i + 1}: ${new Date(g.savedAt).toLocaleString('ja-JP')}`).join('\n');
    const pick = prompt(`復旧する世代を選んでください（1〜${Math.min(30, gens.length)}）:\n${list}`, '1');
    if (!pick) return;
    const idx = Math.max(1, Math.min(gens.length, Number(pick))) - 1;
    const { fromJson } = await import('../io/xcad.js');
    this.app.loadDocument(fromJson(gens[idx].json));
    this.app.setStatus('自動保存データから復旧しました');
  }

  private async loadSample(): Promise<void> {
    if (this.app.store.dirty && !confirm('保存していない変更があります。サンプル図面を読み込みますか？')) return;
    const { sampleDrawing } = await import('./sample.js');
    this.app.loadDocument(sampleDrawing());
    this.app.setStatus('サンプル図面「取付ブラケット」を読み込みました');
  }

  private async selfTest(): Promise<void> {
    const { runAcceptanceTests } = await import('./selftest.js');
    const res = runAcceptanceTests();
    const body = res.map((r) => `${r.ok ? '✅' : '❌'} ${r.name}\n    ${r.detail}`).join('\n');
    const okCount = res.filter((r) => r.ok).length;
    alert(`精度・機能の自己診断（仕様 第11章 検収チェックリスト）\n\n${body}\n\n${okCount}/${res.length} 項目に合格`);
  }
}

function typeLabel(e: Entity): string {
  const m: Record<string, string> = {
    line: '線分', circle: '円', arc: '円弧', polyline: 'ポリライン', text: '文字',
    point: '点', ellipse: '楕円', insert: 'ブロック参照', hatch: 'ハッチング', dim: '寸法',
  };
  return m[e.type] ?? e.type;
}

function ltLabel(t: LineTypeName): string {
  return ({ CONTINUOUS: '実線', HIDDEN: '破線', CENTER: '一点鎖線', PHANTOM: '二点鎖線' } as Record<LineTypeName, string>)[t];
}

function constraintLabel(t: string): string {
  const m: Record<string, string> = {
    coincident: '一致', horizontal: '水平', vertical: '垂直', parallel: '平行', perpendicular: '直角',
    tangent: '接線', concentric: '同心', equal: '等しい', symmetric: '対称', fixed: '固定', pointOn: '上にある',
    distance: '距離', distanceH: '水平距離', distanceV: '垂直距離', radius: '半径', diameter: '直径', angle: '角度',
  };
  return m[t] ?? t;
}

function c2Editable(doc: CadDocument): boolean {
  return doc.constraints.some((c) => c.value !== undefined);
}

export { download, umToMm, onCircle, defaultSheet, degToUDeg, UDEG_PER_DEG };
