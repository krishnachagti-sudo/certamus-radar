import { dayDiff } from '../dates.js';

const KEEP_DAYS = 60;

function expired(rec, decisions, today) {
  if (!rec.closed_on) return false;
  const d = decisions[rec.id];
  const committed = d?.status === 'entering' || d?.registered === true;
  const anchor = committed
    ? (rec.comp_end || rec.regn_close || rec.closed_on)
    : rec.closed_on;
  return dayDiff(anchor, today) > KEEP_DAYS;
}

// Returns { next, pruned }: pruned records (closed long enough ago) leave the
// live file and go to the archive (run.js appends them).
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
  const kept = [];
  const pruned = [];
  for (const r of next) (expired(r, decisions, today) ? pruned : kept).push(r);
  kept.sort((a, b) => (a.regn_close || '9999').localeCompare(b.regn_close || '9999'));
  return { next: kept, pruned };
}

// The archive keeps only what the Hosts page needs: never body text,
// eligibility or verdict reasons. Append-only, deduped by id.
const ARCHIVE_FIELDS = ['id', 'title', 'host', 'tier', 'url', 'regn_close', 'comp_end', 'first_seen', 'closed_on', 'format', 'is_case'];

export function appendArchive(archive, pruned) {
  if (!pruned.length) return archive;
  const have = new Set(archive.map(a => String(a.id)));
  const out = [...archive];
  for (const p of pruned) {
    if (have.has(String(p.id))) continue;
    have.add(String(p.id));
    const slim = {};
    for (const k of ARCHIVE_FIELDS) slim[k] = p[k] ?? null;
    out.push(slim);
  }
  return out;
}
