import { dayDiff } from '../dates.js';

const KEEP_DAYS = 60;

function expired(rec, decisions, today) {
  if (!rec.closed_on) return false;
  const anchor = decisions[rec.id]?.status === 'entering'
    ? (rec.comp_end || rec.regn_close || rec.closed_on)
    : rec.closed_on;
  return dayDiff(anchor, today) > KEEP_DAYS;
}

export function merge(existing, fetched, decisions, today) {
  const prev = new Map(existing.map(r => [r.id, r]));
  const seen = new Set();
  const next = [];
  for (const f of fetched) {
    seen.add(f.id);
    const p = prev.get(f.id);
    const past = f.regn_close && dayDiff(today, f.regn_close) < 0;
    next.push({ ...f, first_seen: p?.first_seen || today, closed_on: past ? (p?.closed_on || today) : null });
  }
  for (const p of existing) {
    if (!seen.has(p.id)) next.push({ ...p, closed_on: p.closed_on || today });
  }
  return next
    .filter(r => !expired(r, decisions, today))
    .sort((a, b) => (a.regn_close || '9999').localeCompare(b.regn_close || '9999'));
}
