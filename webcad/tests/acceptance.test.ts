/** 仕様 第11章「検収チェックリスト」を自動テストとして実行する */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runAcceptanceTests } from '../src/app/selftest.js';

const results = runAcceptanceTests();
for (const r of results) {
  test(r.name, () => {
    assert.ok(r.ok, r.detail);
  });
}

test('検収項目の総数', () => {
  assert.ok(results.length >= 10, `検収項目が少なすぎます: ${results.length}`);
});
