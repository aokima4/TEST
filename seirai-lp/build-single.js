/* index.html + style.css + main.js を1ファイルのHTMLにまとめる（配布・公開用） */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, 'assets/style.css'), 'utf8');
const js  = fs.readFileSync(path.join(__dirname, 'assets/main.js'), 'utf8');

const title = (src.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'SEIRAI';
const fontLink = (src.match(/<link href="https:\/\/fonts\.googleapis\.com[^>]*>/) || [''])[0];
const body = src.split('<body>')[1].split('</body>')[0]
  .replace(/<script src="assets\/main\.js" defer><\/script>/, '');

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
