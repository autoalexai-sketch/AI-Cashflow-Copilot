// app.html and demo.html load /calc.js?v=<first 8 hex of sha256(calc.js)>.
// A browser that cached an old calc.js runs new app code against old money
// logic (2026-11-22: SBCalc.explainMonth missing, monthly close broken).
// Changing calc.js without bumping ?v= fails this test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.join(__dirname, '..');
const v = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'calc.js'))).digest('hex').slice(0, 8);

for (const page of ['app.html', 'demo.html']) {
  test(`${page} loads calc.js with the current version`, () => {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.match(html, new RegExp(`<script src="/calc\\.js\\?v=${v}"></script>`),
      `bump ?v= in ${page} to ${v} (sha256 of calc.js)`);
  });
}

test('_headers: calc.js is revalidated on every load', () => {
  const h = fs.readFileSync(path.join(root, '_headers'), 'utf8');
  assert.match(h, /^\/calc\.js\n\s+Cache-Control: no-cache$/m);
});
