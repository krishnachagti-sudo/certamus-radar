// Date hygiene before sync_section: one impossible calendar date must not
// fail the whole section's write (Postgres would reject the ::date cast).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validDate, cleanDates, commit } from '../fetch/pipeline.js';

test('validDate: real calendar dates only', () => {
  for (const d of ['2026-10-05', '2028-02-29', '2026-12-31']) assert.equal(validDate(d), true, d);
  for (const d of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-5', '05-10-2026', '', 'soon', 20261005, '2026-10-05T00:00:00Z']) {
    assert.equal(validDate(d), false, String(d));
  }
});

test('cleanDates: an invalid date becomes null with a warning; null and valid dates are untouched', () => {
  const warnings = [];
  const rows = [
    { id: 1, regn_close: '2026-02-30', comp_end: '2026-03-10', closed_on: null },
    { id: 'intl-a', regn_close: '2026-11-01', comp_end: 'TBA' },
    { id: 2 },
  ];
  const out = cleanDates(rows, warnings);
  assert.deepEqual(out, [
    { id: 1, regn_close: null, comp_end: '2026-03-10', closed_on: null },
    { id: 'intl-a', regn_close: '2026-11-01', comp_end: null },
    { id: 2 },
  ]);
  assert.deepEqual(warnings, [
    '1: invalid regn_close "2026-02-30" stored as empty',
    'intl-a: invalid comp_end "TBA" stored as empty',
  ]);
  assert.equal(rows[0].regn_close, '2026-02-30', 'input not mutated');
});

test('commit cleans the rows and archive it sends and adds the warnings to the run status', async () => {
  const calls = [];
  const db = { async syncSection(...a) { calls.push(a); return {}; } };
  const status = { last_ok: 't', warnings: ['earlier'] };
  await commit(db, 'case', {
    existing: [{ id: 9, title: 'old', regn_close: '2026-02-31', closed_on: '2026-01-01', first_seen: '2025-12-01' }],
    records: [{ id: 1, title: 'A', regn_close: '2026-11-31' }],
    decisions: {}, today: '2026-10-05', prune: true, status,
  });
  assert.equal(calls.length, 1);
  const [section, rows, archive, st] = calls[0];
  assert.equal(section, 'case');
  assert.deepEqual(rows.map(r => [r.id, r.regn_close]), [[1, null]]);
  assert.deepEqual(archive.map(a => [a.archive_key, a.regn_close]), [['9', null]]);
  assert.equal(st, status);
  assert.deepEqual(status.warnings, ['earlier', '1: invalid regn_close "2026-11-31" stored as empty', '9: invalid regn_close "2026-02-31" stored as empty']);
});
