// One-shot entry points for the Railway cron services (railway/fetch.json,
// railway/watch.json): `npm run job:fetch` and `npm run job:watch`.
// Each runs once and exits; Railway shows the exit code on the cron run.
//
// fetch: the case section (fetch/run.js), then the hack section
// (fetch/hack-run.js), one after the other. Each section writes its own data
// or, on failure, its own status (which the board shows), so one section
// failing never blocks the other. The run exits 1 only when BOTH failed,
// which points at the network, the API or the variables, not at a source.
//
// watch: the weekly official-page watcher (fetch/watch.js), its own exit code.
import { pathToFileURL } from 'node:url';

// A section's main() -> true when it returned 0. A throw counts as a failure
// of that section only, so the other still runs.
async function ok(name, run) {
  try {
    return (await run()) === 0;
  } catch (e) {
    console.error(`${name}: ${e?.message || e}`);
    return false;
  }
}

export async function fetchJob({ runCase, runHack } = {}) {
  runCase ??= async () => (await import('./run.js')).main();
  runHack ??= async () => (await import('./hack-run.js')).main();
  const caseOk = await ok('case', runCase);
  const hackOk = await ok('hack', runHack);
  console.log(`fetch job: case ${caseOk ? 'ok' : 'failed'}, hack ${hackOk ? 'ok' : 'failed'}`);
  return caseOk || hackOk ? 0 : 1;
}

export async function watchJob({ runWatch } = {}) {
  runWatch ??= async () => (await import('./watch.js')).main();
  return (await ok('watch', runWatch)) ? 0 : 1;
}

export const JOBS = { fetch: fetchJob, watch: watchJob };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const job = JOBS[process.argv[2]];
  if (!job) {
    console.error(`usage: node fetch/job.js <${Object.keys(JOBS).join('|')}>`);
    process.exit(2);
  }
  // Exit explicitly: a cron service must end, and an idle keep-alive socket
  // must not hold the process open past the run.
  process.exit(await job());
}
