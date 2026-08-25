#!/usr/bin/env node
/** 依存ゼロの開発用サーバ。TypeScript はリクエスト時に esbuild でバンドルする。 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT ?? 5173);
const useDist = process.argv.includes('--dist');

const types = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.svg': 'image/svg+xml',
};

let cache = null;
async function bundle() {
  const r = await build({
    entryPoints: [path.join(root, 'src/app/main.ts')],
    bundle: true, write: false, format: 'esm', sourcemap: 'inline',
    target: ['chrome110'], logLevel: 'warning',
  });
  return r.outputFiles[0].text;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    if (p === '/app.js' && !useDist) {
      if (!cache || process.env.NO_CACHE) cache = await bundle();
      res.writeHead(200, { 'content-type': types['.js'], 'cache-control': 'no-store' });
      res.end(cache);
      return;
    }
    const base = useDist ? 'dist' : 'public';
    const file = path.join(root, base, p);
    if (!file.startsWith(path.join(root, base))) { res.writeHead(403); res.end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('見つかりません');
  }
});

// ソース変更時にバンドルを作り直す
if (!useDist) {
  const { watch } = await import('node:fs');
  watch(path.join(root, 'src'), { recursive: true }, () => { cache = null; });
}

server.listen(port, () => {
  console.log(`WebCAD 開発サーバ: http://localhost:${port}/`);
});
