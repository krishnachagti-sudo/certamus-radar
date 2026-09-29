import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../fetch/run.js';

function dataDir(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-'));
  const files = {
    'team.json': { size: 4, passout_years: [2029] },
    'keywords.json': ['case'],
    'bschools.json': [],
    'corporates.json': [],
    'competitions.json': [{ id: 77, title: 'Old', regn_close: '2026-12-01', first_seen: '2026-09-01', closed_on: null }],
    'decisions.json': {},
    'manual.json': [],
    'status.json': { last_ok: '2026-09-28T00:30:00.000Z' },
    ...over,
  };
  for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), JSON.stringify(v));
  return dir;
}
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f)));
const item = {
  id: 1, title: 'Ops', updated_at: 'x', end_date: '2026-11-09T21:25:00+05:30',
  organisation: { name: 'Indian Institute of Management (IIM), Raipur' },
  regnRequirements: { min_team_size: 2, max_team_size: 3, end_regn_dt: '2026-11-09T21:25:00+05:30', eligibility: '{"sector":["students"],"others":["all"]}' },
  filters: [{ name: 'All', type: 'eligible' }], prizes: [], isPaid: false, region: 'online',
  details: '<p>All students.</p>',
};
const now = new Date('2026-09-29T00:30:00Z');

test('success writes classified competitions and a clean status', async () => {
  const dir = dataDir();
  const getJson = async url => ({ data: { data: [item], last_page: 1 } });
  const code = await main({ dataDir: dir, now, deps: { getJson, pause: async () => {} } });
  assert.equal(code, 0);
  const comps = read(dir, 'competitions.json');
  const ops = comps.find(c => c.id === 1);
  assert.equal(ops.tier, 'iim');
  assert.equal(ops.verdict.level, 'fits');
  assert.equal(comps.find(c => c.id === 77).closed_on, '2026-09-29');
  const st = read(dir, 'status.json');
  assert.equal(st.last_ok, now.toISOString());
  assert.equal(st.last_error, null);
});

test('failure leaves competitions untouched and records the error', async () => {
  const dir = dataDir();
  const before = fs.readFileSync(path.join(dir, 'competitions.json'), 'utf8');
  const code = await main({ dataDir: dir, now, deps: { getJson: async () => ({ data: {} }), pause: async () => {} } });
  assert.equal(code, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'competitions.json'), 'utf8'), before);
  const st = read(dir, 'status.json');
  assert.equal(st.last_ok, '2026-09-28T00:30:00.000Z');
  assert.equal(st.last_run, now.toISOString());
  assert.match(st.last_error, /shape/);
});
