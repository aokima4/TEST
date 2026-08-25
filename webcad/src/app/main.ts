/** 起動処理：キーボードショートカット（AutoCAD互換）とアプリの組み立て */
import { App } from './app.js';
import { UI } from './ui.js';
import { registerCommands } from './commands.js';
import { emptyDocument } from '../model/types.js';
import { localStore } from './storage.js';

async function boot(): Promise<void> {
  const app = new App(emptyDocument('無題'));
  registerCommands(app);
  const ui = new UI(app);
  ui.mount();
  app.attach(document.getElementById('canvas') as HTMLCanvasElement);
  app.zoomExtents();

  // 前回の自動保存があれば復旧を提案
  try {
    const prev = await localStore.load(app.docKey);
    if (prev && prev.entities.length) {
      if (confirm(`前回の作業内容（図形${prev.entities.length}個）が残っています。復旧しますか？`)) {
        app.loadDocument(prev);
      }
    }
  } catch { /* 復旧できなくても起動は続ける */ }

  const cmdline = document.getElementById('cmdline') as HTMLInputElement;

  window.addEventListener('keydown', (e) => {
    const inField = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;

    // Ctrl系はどこでも効く
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); app.store.undo(); app.runSolver(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); app.store.redo(); app.runSolver(); return; }
      if (k === 's') { e.preventDefault(); document.querySelector<HTMLButtonElement>('.tb[title^="\.xcad で保存"]')?.click(); return; }
      if (k === 'a') { e.preventDefault(); for (const en of app.doc.entities) app.selection.add(en.id); app.emit('selection'); app.invalidate(); return; }
      if (k === '0') { e.preventDefault(); app.zoomExtents(); return; }
      return;
    }

    if (e.key === 'F3') { e.preventDefault(); app.snap.enabled = !app.snap.enabled; app.emit('options'); return; }
    if (e.key === 'F7') { e.preventDefault(); app.options.grid = !app.options.grid; app.snap.gridOn = app.options.grid; app.emit('options'); app.invalidate(); return; }
    if (e.key === 'F8') { e.preventDefault(); app.options.ortho = !app.options.ortho; app.emit('options'); return; }

    if (inField) {
      if (e.key === 'Escape') { app.cancel(); (e.target as HTMLElement).blur(); }
      return;
    }
    if (app.handleKey(e)) { e.preventDefault(); return; }

    // 印字可能キーはコマンドラインへ流す（AutoCAD 風の操作感）
    if (e.key.length === 1 && !e.altKey) {
      cmdline.focus();
      cmdline.value += e.key;
      e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => app.handleKeyUp(e));

  // ドラッグ＆ドロップでファイルを開く
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  canvas.addEventListener('dragover', (e) => e.preventDefault());
  canvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    void (async (): Promise<void> => {
      if (/\.dxf$/i.test(f.name)) {
        const { readDxf } = await import('../io/dxfread.js');
        app.loadDocument(readDxf(await f.text(), f.name.replace(/\.dxf$/i, '')).doc);
      } else {
        const { loadBlob } = await import('../io/xcad.js');
        app.loadDocument(await loadBlob(f));
      }
    })();
  });

  (window as unknown as { cad: App }).cad = app;
}

void boot();
