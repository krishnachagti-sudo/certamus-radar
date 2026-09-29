import { dayDiff } from '../dates.js';

const KEEP_DAYS = 60;

function expired(rec, decisions, today) {
  if (rec.source === 'curated') return false; // standing entries: never pruned
  if (!rec.closed_on) return false;
  const d = decisions[rec.id];
  const committed = d?.status === 'entering' || d?.registered === true;
  const anchor = committed
    ? (rec.comp_end || rec.regn_close || rec.closed_on)
    : rec.closed_on;
  return dayDiff(anchor, today) > KEEP_DAYS;
}

// Returns { next, pruned }. `pruned` is what run.js appends to the archive:
// records closed long enough ago (they leave the live file), plus curated
// records whose confirmed regn_close has passed (they stay in the live file;
// appendArchive keys them per edition, so each edition is archived once).
// prune=false keeps expired records for a run whose decisions could not be
// read: without them, an entering or registered record would look expired.
export function merge(existing, fetched, decisions, today, { prune = true } = {}) {
  const prev = new Map(existing.map(r => [r.id, r]));
  const seen = new Set();
  const next = [];
  for (const f of fetched) {
    seen.add(f.id);
    const p = prev.get(f.id);
    const past = f.regn_close && dayDiff(today, f.regn_close) < 0;
    const closed_on = f.source === 'curated' ? null : (past ? (p?.closed_on || today) : null);
    next.push({ ...f, first_seen: p?.first_seen || today, closed_on });
  }
  for (const p of existing) {
    if (!seen.has(p.id)) next.push({ ...p, closed_on: p.source === 'curated' ? null : (p.closed_on || today) });
  }
  const kept = [];
  const pruned = [];
  for (const r of next) {
    if (prune && expired(r, decisions, today)) { pruned.push(r); continue; }
    kept.push(r);
    if (r.source === 'curated' && r.regn_close && dayDiff(today, r.regn_close) < 0) pruned.push(r);
  }
  kept.sort((a, b) => (a.regn_close || '9999').localeCompare(b.regn_close || '9999'));
  return { next: kept, pruned };
}

// The archive keeps only what the Hosts page needs: never body text,
// eligibility or verdict reasons. Append-only, deduped by archive_key:
// the id, or id@regn_close for a curated edition.
const ARCHIVE_FIELDS = ['id', 'title', 'host', 'tier', 'url', 'regn_close', 'comp_end', 'first_seen', 'closed_on', 'format', 'is_case', 'source'];

export const archiveKey = r => (r.source === 'curated' && r.regn_close ? `${r.id}@${r.regn_close}` : String(r.id));

export function appendArchive(archive, pruned) {
  if (!pruned.length) return archive;
  const have = new Set(archive.map(a => a?.archive_key ?? String(a?.id)));
  const out = [...archive];
  for (const p of pruned) {
    const key = archiveKey(p);
    if (have.has(key)) continue;
    have.add(key);
    const slim = { archive_key: key };
    for (const k of ARCHIVE_FIELDS) slim[k] = p[k] ?? null;
    out.push(slim);
  }
  return out;
}
