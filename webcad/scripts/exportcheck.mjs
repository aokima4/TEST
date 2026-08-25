/** サンプル図面を各形式で書き出し、往復と見た目を検証する */
import { build } from 'esbuild';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
await build({
  entryPoints: [path.join(root, 'scripts/_export-entry.ts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outfile: path.join(root, 'build/exportcheck.mjs'), logLevel: 'warning',
});
await import(path.join(root, 'build/exportcheck.mjs'));
void writeFile; void mkdir;
