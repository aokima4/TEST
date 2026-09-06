/* index.html + style.css + main.js を1ファイルのHTMLにまとめる（配布・公開用） */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'assets/style.css'), 'utf8');
const js  = fs.readFileSync(path.join(__dirname, 'assets/main.js'), 'utf8');

const title = (src.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'SEIRAI';
const fontLink = (src.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/) || [''])[0];
let body = src.split('<body>')[1].split('</body>')[0]
  .replace(/<script src="assets\/main\.js" defer><\/script>/, '');

/* 画像をdata URIとして埋め込み、1ファイルだけで表示できるようにする */
const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
body = body.replace(/src="(assets\/images\/[^"]+)"/g, (m, rel) => {
  const abs = path.join(__dirname, rel);
  if (!fs.existsSync(abs)) return m;
  const type = mime[path.extname(abs).toLowerCase()];
  if (!type) return m;
  return 'src="data:' + type + ';base64,' + fs.readFileSync(abs).toString('base64') + '"';
});

const out = [
  `<title>${title}</title>`,
  fontLink,
  `<style>\n${css}\n</style>`,
  body.trim(),
  `<script>\n${js}\n</script>`,
  ''
].join('\n');

const dest = process.argv[2] || path.join(__dirname, 'seirai-lp-single.html');
fs.writeFileSync(dest, out);
console.log('written:', dest, Buffer.byteLength(out), 'bytes');
