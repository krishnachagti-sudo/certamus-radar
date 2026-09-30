// Shared plumbing for the daily jobs (run.js for case comps, hack-run.js for
// hackathons): data/ file access, Supabase fallbacks, curated lists, and the
// merge + archive + write step. Nothing here knows which section it serves.
import fs from 'node:fs';
import path from 'node:path';
import { merge, appendArchive } from './merge.js';
import { curatedRecords } from './intl.js';

// Listing body text, the raw eligibility blob and derived eligibility facts
// are used for classification only and never written: the body text carries
// organisers' personal phone numbers and emails, and the files are public.
export const PRIVATE_FIELDS = ['details_text', 'eligibility', 'carried_over', 'facts'];
export const publishable = r => {
  const out = { ...r };
  for (const k of PRIVATE_FIELDS) delete out[k];
  return out;
};

export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function dataStore(dataDir) {
  const file = f => path.join(dataDir, f);
  const read = (f, fallback) => {
    try { return JSON.parse(fs.readFileSync(file(f), 'utf8')); } catch { return fallback; }
  };
  const write = (f, v) => fs.writeFileSync(file(f), JSON.stringify(v, null, 2) + '\n');
  // Tells "missing" apart from "there but broken", for files we must not clobber.
  const readStrict = f => {
    let raw;
    try { raw = fs.readFileSync(file(f), 'utf8'); } catch { return { missing: true }; }
    try { return { value: JSON.parse(raw) }; } catch (e) { return { error: `unparseable (${e.message})` }; }
  };
  return { file, read, write, readStrict };
}

// A Supabase table's value, or the old data/ file when the read failed (else
// `fallback`); the fallback is a warning pushed onto `warnings`.
export function fromRemote(remote, name, store, file, fallback, warnings) {
  if (remote[name].value !== undefined) return remote[name].value;
  const local = store.readStrict(file);
  const usable = 'value' in local;
  warnings.push(`${name}: ${remote[name].error}; ${usable ? `using data/${file}` : 'none'}`);
  return usable ? local.value : fallback;
}

export function readDecisions(remote, store, warnings) {
  const raw = fromRemote(remote, 'decisions', store, 'decisions.json', {}, warnings);
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

// Merge, archive, write the live file. Archive first: if the run dies between
// the two writes, a pruned record is archived and still live, never lost.
export function commit(store, { existing, records, decisions, today, prune, warnings, liveFile, archiveFile, archiveFields }) {
  const { next, pruned } = merge(existing.map(publishable), records.map(publishable), decisions, today, { prune });
  if (pruned.length) {
    const arch = store.readStrict(archiveFile);
    if (arch.missing) store.write(archiveFile, appendArchive([], pruned, archiveFields));
    else if (arch.error || !Array.isArray(arch.value)) {
      warnings.push(`${archiveFile} ${arch.error || 'is not an array'}; archive not written this run`);
    } else store.write(archiveFile, appendArchive(arch.value, pruned, archiveFields));
  }
  store.write(liveFile, next);
  return next;
}
