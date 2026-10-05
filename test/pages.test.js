// How every page loads: one module script, no third-party code, and a CSP
// whose connect-src is exactly this site plus the API in config.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { API_URL } from '../config.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root)).toString();
const pages = readdirSync(root).filter(f => f.endsWith('.html'));
const cspOf = html => /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];

test('every page loads exactly one script: its own module', () => {
  assert.deepEqual(pages.sort(), ['all.html', 'c.html', 'calendar.html', 'hosts.html', 'index.html', 'team.html']);
  for (const f of pages) {
    const scripts = [...read(f).matchAll(/<script\b[^>]*>/g)].map(m => m[0]);
    assert.equal(scripts.length, 1, f);
    assert.match(scripts[0], /^<script type="module" src="pages\/[a-z]+\.js">$/, f);
  }
  assert.equal(existsSync(new URL('vendor/', root)), false, 'no vendored client any more');
});

test('the CSP is identical on every page and keeps script-src self', () => {
  const csps = pages.map(f => cspOf(read(f)));
  assert.equal(new Set(csps).size, 1);
  assert.equal(csps[0], `default-src 'self'; script-src 'self'; connect-src 'self' ${new URL(API_URL).origin}; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'`);
});

test('config.js: an https API origin with no path or trailing slash', () => {
  const u = new URL(API_URL);
  assert.equal(u.protocol, 'https:');
  assert.equal(API_URL, u.origin);
});
