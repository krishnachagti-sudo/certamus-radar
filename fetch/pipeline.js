// Shared plumbing for the daily jobs (run.js for case comps, hack-run.js for
// hackathons): config files in data/, the database reads (API), curated lists, and
// the merge + archive + sync step. Nothing here knows which section it serves.
//
// The live records, the archive and the run status live in Postgres behind
// the API (listings / archive / source_status, written only through
// sync_section and set_status). data/ holds only hand-edited config (team, tiers, curated
// lists), read here and never written.
import fs from 'node:fs';
import path from 'node:path';
import { merge, appendArchive } from './merge.js';
import { curatedRecords } from './intl.js';

// Listing body text, the raw eligibility blob and derived eligibility facts
// are used for classification only and never stored: the body text carries
// organisers' personal phone numbers and emails.
export const PRIVATE_FIELDS = ['details_text', 'eligibility', 'carried_over', 'facts'];
export const publishable = r => {
  const out = { ...r };
  for (const k of PRIVATE_FIELDS) delete out[k];
  return out;
};

export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// Read-only access to the config files in data/.
export function configStore(dataDir) {
  const file = f => path.join(dataDir, f);
  const read = (f, fallback) => {
    try { return JSON.parse(fs.readFileSync(file(f), 'utf8')); } catch { return fallback; }
  };
  // Tells "missing" apart from "there but broken".
  const readStrict = f => {
    let raw;
    try { raw = fs.readFileSync(file(f), 'utf8'); } catch { return { missing: true }; }
    try { return { value: JSON.parse(raw) }; } catch (e) { return { error: `unparseable (${e.message})` }; }
  };
  return { file, read, readStrict };
}

// A database table's value, or `fallback` with a warning when the read failed.
export function fromRemote(remote, name, fallback, warnings) {
  if (remote[name].value !== undefined) return remote[name].value;
  warnings.push(`${name}: ${remote[name].error}; none`);
  return fallback;
}

export function readDecisions(remote, warnings) {
  const raw = fromRemote(remote, 'decisions', {}, warnings);
  return isObject(raw) ? raw : {};
}

// Curated lists (same row shape). A problem with one keeps yesterday's
// records from that list (and their dates) rather than closing them; an
// optional list that is missing just adds no rows.
export function curatedFromLists(lists, { store, remote, existing, today, warnings }) {
  const out = [];
  for (const { f, prefix, label, optional } of lists) {
    const listFile = store.readStrict(f);
    if (optional && listFile.missing) continue;
    const problem =
      listFile.missing ? `${f} missing`
        : listFile.error ? `${f} ${listFile.error}`
          : !Array.isArray(listFile.value) ? `${f} is not an array`
            : remote.intlDates.error ? `confirmed dates unavailable (${remote.intlDates.error})`
              : null;
    if (problem) {
      warnings.push(`${label}: ${problem}; previous ${prefix} records kept`);
      out.push(...existing.filter(r => r.source === 'curated' && String(r.id).startsWith(prefix)));
    } else {
      out.push(...curatedRecords(listFile.value, remote.intlDates.value, today));
    }
  }
  return out;
}

// The date fields sync_section copies into date columns. A real calendar
// date (YYYY-MM-DD) or nothing: Postgres rejects an impossible date such as
// 2026-02-30, and one bad row must not fail the whole section's write.
export const DATE_FIELDS = ['regn_close', 'comp_end', 'closed_on'];

export function validDate(v) {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

// Copies of `rows` with any invalid date field set to null, one warning each.
export function cleanDates(rows, warnings) {
  return rows.map(r => {
    let out = r;
    for (const k of DATE_FIELDS) {
      const v = r?.[k];
      if (v === null || v === undefined || validDate(v)) continue;
      if (out === r) out = { ...r };
      out[k] = null;
      warnings.push(`${r.id ?? r.archive_key}: invalid ${k} ${JSON.stringify(v)} stored as empty`);
    }
    return out;
  });
}

// Merge, then one sync_section call: the pruned records' archive entries,
// the section's full next set of rows (anything not in it is deleted from
// that section only) and the run status, in one transaction. Invalid dates
// are nulled first; their warnings join the status's warnings.
export async function commit(db, section, { existing, records, decisions, today, prune, archiveFields, status }) {
  const merged = merge(existing.map(publishable), records.map(publishable), decisions, today, { prune });
  const dateWarnings = [];
  const next = cleanDates(merged.next, dateWarnings);
  const archive = cleanDates(appendArchive([], merged.pruned, archiveFields), dateWarnings);
  if (dateWarnings.length && status) {
    if (Array.isArray(status.warnings)) status.warnings.push(...dateWarnings);
    else status.warnings = dateWarnings;
  }
  await db.syncSection(section, next, archive, status);
  return { next, archive };
}

// A failed run writes only its status, carrying the previous last_ok (and
// sources) so the banner says how old the data is. If the previous status
// cannot be read, last_ok is null. Never throws.
export async function recordFailure(db, section, { stamp, message, warnings = [], sources }) {
  let prev = null;
  const w = [...warnings];
  try { prev = await db.readStatus(section); } catch (e) { w.push(`previous status unreadable: ${e.message}`); }
  const status = { last_run: stamp, last_ok: prev?.last_ok ?? null, last_error: message, warnings: w };
  const carried = prev?.sources ?? sources;
  if (carried !== undefined) status.sources = carried;
  try { await db.setStatus(section, status); } catch (e) { console.error(`${section} status not recorded: ${e.message}`); }
  return status;
}
