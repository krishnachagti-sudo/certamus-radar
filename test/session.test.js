import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannersHtml, guardLoad, footerHtml } from '../lib/session.js';

test('banners: stale from source_status, errors escaped, no "not configured" banner', () => {
  const fresh = { last_ok: new Date().toISOString(), last_error: null };
  assert.equal(bannersHtml(fresh, null), '');
  assert.match(bannersHtml({ last_ok: fresh.last_ok, last_error: 'Unstop <down>' }, null), /Data stale since .*: Unstop &lt;down&gt;/);
  assert.match(bannersHtml({ last_ok: '2026-01-01T00:00:00Z' }, null), /Data stale since/);
  assert.match(bannersHtml({}, null), /Data stale since never/);
  assert.match(bannersHtml(fresh, 'Not saved: <x>'), /role="alert">Not saved: &lt;x&gt;</);
  assert.doesNotMatch(bannersHtml(fresh, null), /configured/);
});

test('banners: nothing stale while the status has not loaded', () => {
  assert.equal(bannersHtml(null, null), '');
  assert.match(bannersHtml(null, 'Could not load data: offline'), /Could not load data: offline/);
  assert.doesNotMatch(bannersHtml(null, 'x'), /stale/);
});

test('guardLoad turns a failed read into the error banner text', async () => {
  const state = { error: 'old' };
  await guardLoad(state, async () => { state.loaded = true; });
  assert.equal(state.error, null);
  assert.equal(state.loaded, true);
  await guardLoad(state, async () => { throw new Error('JWT expired'); });
  assert.equal(state.error, 'Could not load data: JWT expired');
});

test('footer: last update only, no edit-link button', () => {
  assert.match(footerHtml(null), /Updated never/);
  assert.doesNotMatch(footerHtml(null), /lock|Stop editing/);
});
