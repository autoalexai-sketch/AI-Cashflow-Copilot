// Niche landing /ekipy: checks that the page stays honest and trackable.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ekipy.html'), 'utf8');

test('ekipy: Polish page with its own canonical URL', () => {
  assert.match(html, /<html lang="pl">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/splitbooks\.pl\/ekipy" \/>/);
});

test('ekipy: every CTA to /demo or /app carries utm_source=landing_ekipy', () => {
  const links = [...html.matchAll(/href="(\/(?:demo|app)[^"]*)"/g)].map(m => m[1]);
  assert.ok(links.length >= 2, 'expected at least two CTAs');
  for (const href of links) assert.match(href, /utm_source=landing_ekipy/, href);
});

test('ekipy: promises nothing the product does not have yet', () => {
  for (const word of [/KSeF/i, /OCR/i, /import\w* (?:wyciąg|bank)/i, /integracj\w* z bank/i]) {
    assert.doesNotMatch(html, word);
  }
});

test('ekipy: listed in sitemap and .html redirects to clean URL', () => {
  const sitemap = fs.readFileSync(path.join(root, 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /<loc>https:\/\/splitbooks\.pl\/ekipy<\/loc>/);
  const redirects = fs.readFileSync(path.join(root, '_redirects'), 'utf8');
  assert.match(redirects, /^\/ekipy\.html\s+\/ekipy\s+301$/m);
});

test('ekipy: offers a free Excel transfer by email, with how the file is used', () => {
  assert.match(html, /Masz wszystko w Excelu\?/);
  assert.match(html, /href="mailto:support@ai-consilium\.com\?subject=/);
  assert.match(html, /tylko do przeniesienia danych/);
});
