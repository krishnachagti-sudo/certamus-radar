import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fetchJob, watchJob } from '../fetch/job.js';

const quiet = async fn => {
  const { log, error } = console;
  console.log = console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, { log, error }); }
};

test('fetch job: exit 1 only when both sections fail', async () => {
  const cases = [
    [0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 1],
  ];
  for (const [c, h, want] of cases) {
    const got = await quiet(() => fetchJob({ runCase: async () => c, runHack: async () => h }));
    assert.equal(got, want, `case=${c} hack=${h}`);
  }
});

test('fetch job: a throwing section is a failure of that section only, and the other still runs', async () => {
  let hackRan = false;
  const got = await quiet(() => fetchJob({
    runCase: async () => { throw new Error('boom'); },
    runHack: async () => { hackRan = true; return 0; },
  }));
  assert.equal(got, 0);
  assert.ok(hackRan);
  assert.equal(await quiet(() => fetchJob({
    runCase: async () => { throw new Error('a'); },
    runHack: async () => { throw new Error('b'); },
  })), 1);
});

test('fetch job: case runs before hack', async () => {
  const order = [];
  await quiet(() => fetchJob({ runCase: async () => { order.push('case'); return 0; }, runHack: async () => { order.push('hack'); return 0; } }));
  assert.deepEqual(order, ['case', 'hack']);
});

test('watch job: passes the watcher exit code through', async () => {
  assert.equal(await quiet(() => watchJob({ runWatch: async () => 0 })), 0);
  assert.equal(await quiet(() => watchJob({ runWatch: async () => 1 })), 1);
  assert.equal(await quiet(() => watchJob({ runWatch: async () => { throw new Error('x'); } })), 1);
});

test('railway cron configs: schedule, start command, never restart', () => {
  const read = f => JSON.parse(fs.readFileSync(new URL(`../railway/${f}`, import.meta.url), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const want = { 'fetch.json': ['30 0,12 * * *', 'npm run job:fetch'], 'watch.json': ['30 23 * * 0', 'npm run job:watch'] };
  for (const [f, [cron, start]] of Object.entries(want)) {
    const { deploy } = read(f);
    assert.equal(deploy.cronSchedule, cron, f);
    assert.equal(deploy.startCommand, start, f);
    assert.equal(deploy.restartPolicyType, 'NEVER', f);
    assert.equal(deploy.healthcheckPath, undefined, `${f}: a cron job serves nothing`);
    assert.ok(pkg.scripts[start.replace('npm run ', '')], `${start} exists`);
  }
});

test('no GitHub Actions workflows remain (the jobs run on Railway)', () => {
  assert.equal(fs.existsSync(new URL('../.github/workflows/fetch.yml', import.meta.url)), false);
  assert.equal(fs.existsSync(new URL('../.github/workflows/watch.yml', import.meta.url)), false);
});
