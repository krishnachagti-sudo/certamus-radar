import { dayDiff } from './dates.js';

const WINDOW_DAYS = 7;

const datesOf = c => [c.regn_close, c.comp_end].filter(Boolean);

// Names of the entering competitions whose dates fall within a week of any
// date of `target`. An entering competition counts until its last date passes.
export function clashes(target, entering, today) {
  const names = [];
  for (const e of entering) {
    if (e.id === target.id) continue;
    const last = e.comp_end || e.regn_close;
    if (!last || dayDiff(today, last) < 0) continue;
    const hit = datesOf(target).some(t => datesOf(e).some(d => Math.abs(dayDiff(t, d)) <= WINDOW_DAYS));
    if (hit) names.push(e.title);
  }
  return names;
}
