#!/usr/bin/env node
/** esbuild によるビルド。依存はビルド時のみで、実行時はゼロ依存。 */
import { build } from 'esbuild';
import { mkdir, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const single = args.includes('--single');
const tests = args.includes('--tests');

async function buildApp() {
  await mkdir(path.join(root, 'dist'), { recursive: true });
  const result = await build({
    entryPoints: [path.join(root, 'src/app/main.ts')],
    bundle: true,
    format: 'esm',
    target: ['chrome110', 'edge110', 'safari16'],
    outfile: path.join(root, 'dist/app.js'),
    sourcemap: !single,
    minify: single,
    logLevel: 'info',
    metafile: true,
  });
  await cp(path.join(root, 'public/index.html'), path.join(root, 'dist/index.html'));

  if (single) {
    // すべてを1ファイルのHTMLに埋め込む（配布用：ダブルクリックで開ける）
    const html = await readFile(path.join(root, 'dist/index.html'), 'utf8');
    const js = await readFile(path.join(root, 'dist/app.js'), 'utf8');
    const out = html.replace(
      '<script type="module" src="./app.js"></script>',
      `<script type="module">\n${js}\n</script>`,
    );
    await writeFile(path.join(root, 'dist/webcad.html'), out);
    console.log('単一ファイル版: dist/webcad.html');
  }
  const bytes = Object.values(result.metafile.outputs).reduce((s, o) => s + o.bytes, 0);
  console.log(`出力サイズ: ${(bytes / 1024).toFixed(0)} KB`);
}

async function buildTests() {
  const dir = path.join(root, 'tests');
  if (!existsSync(dir)) return;
  const files = (await readdir(dir)).filter((f) => f.endsWith('.ts'));
  await build({
    entryPoints: files.map((f) => path.join(dir, f)),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outdir: path.join(root, 'build/tests'),
    logLevel: 'warning',
  });
  console.log(`テストをビルドしました: ${files.length} ファイル`);
}

if (tests) await buildTests();
else await buildApp();
