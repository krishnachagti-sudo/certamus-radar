// The vendored supabase-js and the way every page loads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root));
const SHA256 = '59d39487c3589843b410322d8a3d562ce022aba1e5ccb16898ef3fb2a0da2ecd';

test('vendor/supabase.js is the pinned 2.117.2 UMD build', () => {
  assert.equal(createHash('sha256').update(read('vendor/supabase.js')).digest('hex'), SHA256);
  const readme = read('vendor/README.md').toString();
  assert.match(readme, /2\.117\.2/);
  assert.ok(readme.includes(SHA256));
});

const pages = readdirSync(root).filter(f => f.endsWith('.html'));

test('every page loads vendor/supabase.js as a classic script before its module', () => {
  assert.deepEqual(pages.sort(), ['all.html', 'c.html', 'calendar.html', 'hosts.html', 'index.html', 'team.html']);
  for (const f of pages) {
    const html = read(f).toString();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(m => m[0]);
    assert.deepEqual(scripts.slice(0, 1), ['<script src="vendor/supabase.js">'], f);
    assert.equal(scripts.length, 2, f);
    assert.match(scripts[1], /^<script type="module" src="pages\/[a-z]+\.js">$/, f);
  }
});

test('the CSP is identical on every page and keeps script-src self', () => {
  const csps = pages.map(f => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(read(f).toString())?.[1]);
  assert.equal(new Set(csps).size, 1);
  assert.equal(csps[0], "default-src 'self'; script-src 'self'; connect-src 'self' https://*.supabase.co; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:");
});
