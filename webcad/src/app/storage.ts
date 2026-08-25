/**
 * ブラウザ内保存（仕様 8章「保存先」・9章「データ消失対策」）
 * - 30秒ごとの自動保存
 * - 履歴30世代を保持し、ブラウザが落ちても復旧できる
 */
import type { CadDocument } from '../model/types.js';
import { toJson, fromJson } from '../io/xcad.js';

const DB_NAME = 'webcad';
const DB_VERSION = 1;
const STORE_DOC = 'documents';
const STORE_HIST = 'history';

export interface DocRecord { key: string; name: string; json: string; savedAt: number }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (): void => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DOC)) db.createObjectStore(STORE_DOC, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_HIST)) {
        const s = db.createObjectStore(STORE_HIST, { keyPath: 'id', autoIncrement: true });
        s.createIndex('key', 'key');
      }
    };
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = (): void => resolve(req.result);
    req.onerror = (): void => reject(req.error);
  });
}

export const MAX_GENERATIONS = 30;

export class LocalStore {
  private db: IDBDatabase | null = null;
  private failed = false;

  async init(): Promise<void> {
    if (this.db || this.failed) return;
    try { this.db = await openDb(); } catch { this.failed = true; }
  }

  get available(): boolean { return !!this.db; }

  async save(key: string, doc: CadDocument): Promise<void> {
    await this.init();
    if (!this.db) { this.saveFallback(key, doc); return; }
    const rec: DocRecord = { key, name: doc.name, json: toJson(doc), savedAt: Date.now() };
    await tx(this.db, STORE_DOC, 'readwrite', (s) => s.put(rec));
    await tx(this.db, STORE_HIST, 'readwrite', (s) => s.add({ key, json: rec.json, savedAt: rec.savedAt } as unknown as DocRecord));
    await this.trimHistory(key);
  }

  private saveFallback(key: string, doc: CadDocument): void {
    try { localStorage.setItem(`webcad:${key}`, toJson(doc)); } catch { /* 容量超過時は黙って諦める */ }
  }

  async load(key: string): Promise<CadDocument | null> {
    await this.init();
    if (!this.db) {
      const t = localStorage.getItem(`webcad:${key}`);
      return t ? fromJson(t) : null;
    }
    const rec = await tx<DocRecord | undefined>(this.db, STORE_DOC, 'readonly', (s) => s.get(key) as IDBRequest<DocRecord | undefined>);
    return rec ? fromJson(rec.json) : null;
  }

  async list(): Promise<DocRecord[]> {
    await this.init();
    if (!this.db) return [];
    const all = await tx<DocRecord[]>(this.db, STORE_DOC, 'readonly', (s) => s.getAll() as IDBRequest<DocRecord[]>);
    return all.sort((a, b) => b.savedAt - a.savedAt);
  }

  async remove(key: string): Promise<void> {
    await this.init();
    if (!this.db) { localStorage.removeItem(`webcad:${key}`); return; }
    await tx(this.db, STORE_DOC, 'readwrite', (s) => s.delete(key));
  }

  async generations(key: string): Promise<{ id: number; savedAt: number; json: string }[]> {
    await this.init();
    if (!this.db) return [];
    const all = await tx<{ id: number; key: string; savedAt: number; json: string }[]>(
      this.db, STORE_HIST, 'readonly', (s) => s.getAll() as IDBRequest<{ id: number; key: string; savedAt: number; json: string }[]>,
    );
    return all.filter((r) => r.key === key).sort((a, b) => b.savedAt - a.savedAt);
  }

  private async trimHistory(key: string): Promise<void> {
    if (!this.db) return;
    const gens = await this.generations(key);
    const extra = gens.slice(MAX_GENERATIONS);
    for (const g of extra) await tx(this.db, STORE_HIST, 'readwrite', (s) => s.delete(g.id));
  }
}

export const localStore = new LocalStore();
