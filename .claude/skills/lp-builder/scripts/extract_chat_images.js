#!/usr/bin/env node
/*
 * チャットに添付された画像を取り出す。
 *
 * なぜ必要か：会話に貼られた画像は「見えている」だけでディスク上には無い。
 * ただし会話ログ(JSONL)には base64 で保存されているので、そこから復元できる。
 * 「写真をもう一度送ってください」とユーザーに頼む前に、必ずこれを試すこと。
 *
 * 使い方:
 *   node extract_chat_images.js --out ./extracted            # 全部出す
 *   node extract_chat_images.js --out ./extracted --last 3   # 直近の添付3枚
 *   node extract_chat_images.js --transcript /path/to.jsonl --out ./extracted
 *
 * 出力: <出力先>/NN_line<行番号>_<role>.<拡張子> と、一覧(寸法つき)を標準出力へ。
 * 同じ画像が複数回貼られることがあるので、寸法と行番号を見て「最後に貼られたもの」を選ぶ。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : def;
}

function newestTranscript() {
  const root = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(root)) return null;
  const files = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.jsonl')) files.push({ full, mtime: fs.statSync(full).mtimeMs });
    }
  })(root);
  files.sort((a, b) => b.mtime - a.mtime);
  return files.length ? files[0].full : null;
}

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
function jpgSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) i += 2;
    else i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}
function size(buf, ext) {
  try {
    if (ext === 'png') return pngSize(buf);
    if (ext === 'jpg') return jpgSize(buf);
  } catch (e) { /* 寸法が読めなくても保存はできる */ }
  return null;
}

const transcript = arg('transcript') || newestTranscript();
if (!transcript || !fs.existsSync(transcript)) {
  console.error('会話ログが見つかりません。--transcript でパスを指定してください。');
  process.exit(1);
}
const outDir = arg('out', './extracted');
fs.mkdirSync(outDir, { recursive: true });

const found = [];
fs.readFileSync(transcript, 'utf8').split('\n').filter(Boolean).forEach((line, li) => {
  let obj;
  try { obj = JSON.parse(line); } catch (e) { return; }
  const msg = obj.message;
  if (!msg || !Array.isArray(msg.content)) return;
  const walk = (block) => {
    if (!block || typeof block !== 'object') return;
    if (block.type === 'image' && block.source && block.source.data) {
      found.push({ line: li, role: msg.role || '?', source: block.source });
    }
    if (Array.isArray(block.content)) block.content.forEach(walk);
  };
  msg.content.forEach(walk);
});

const last = parseInt(arg('last', '0'), 10);
const picked = last > 0 ? found.slice(-last) : found;

picked.forEach((item, idx) => {
  const ext = (item.source.media_type || 'image/png').split('/')[1].replace('jpeg', 'jpg');
  const buf = Buffer.from(item.source.data, 'base64');
  const file = path.join(outDir, `${String(idx + 1).padStart(2, '0')}_line${item.line}_${item.role}.${ext}`);
  fs.writeFileSync(file, buf);
  const s = size(buf, ext);
  console.log(`${file}\t${Math.round(buf.length / 1024)}KB\t${s ? s.w + 'x' + s.h : 'size?'}\trole=${item.role}\tline=${item.line}`);
});
console.log(`\n合計 ${picked.length} 枚 (会話ログ: ${transcript})`);
