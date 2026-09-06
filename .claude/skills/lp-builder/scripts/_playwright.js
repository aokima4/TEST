/* Playwright の場所は環境によって違うため、見つかる場所を順に試す。
   ヘッドレスChromiumは「画像の加工」と「表示崩れの検査」の両方に使う唯一の依存。 */
const CANDIDATES = [
  'playwright',
  '/opt/node22/lib/node_modules/playwright',
  '/usr/lib/node_modules/playwright',
  '/usr/local/lib/node_modules/playwright',
];

function loadPlaywright() {
  for (const p of CANDIDATES) {
    try { return require(p); } catch (e) { /* 次を試す */ }
  }
  throw new Error(
    'playwright が見つかりません。`npm i -g playwright` でインストールするか、\n' +
    'scripts/_playwright.js の CANDIDATES にパスを追加してください。'
  );
}

module.exports = { loadPlaywright };
