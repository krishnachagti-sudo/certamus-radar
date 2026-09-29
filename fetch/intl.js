// International records, built at fetch time so competitions.json stays the
// single source for board, digest and clash. Pure: inputs are arguments.
// Neither source is run through classify: each carries its own verdict.
import { isCaseTitle, stripHtml } from './unstop.js';
import { dayDiff } from '../dates.js';
import { httpsUrl } from '../urls.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = d => (typeof d === 'string' && ISO_DATE.test(d) && validDate(d) ? d : null);

function validDate(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso;
}

function teamMax(teamSize) {
  const nums = String(teamSize ?? '').match(/\d+/g);
  return nums ? Math.max(...nums.map(Number)) : null;
}

function curatedVerdict(row) {
  if (row.indian_ug === 'no') return { level: 'out', reasons: [row.indian_ug_note || 'not open to Indian undergraduates'] };
  if (row.who_applies === 'school') return { level: 'check', reasons: ['IIM Sirmaur must apply for an invitation'] };
  if (row.indian_ug === 'unclear') return { level: 'check', reasons: [row.indian_ug_note || 'eligibility for Indian undergraduates unclear'] };
  return { level: 'fits', reasons: [] };
}

// `confirmedDates` comes from the Supabase intl_dates table: { [id]: { regn_close, comp_end, confirmed_on } }.
// `today` is accepted for symmetry with oppdeskRecords; curated rows do not age out.
export function curatedRecords(list, confirmedDates, today) { // eslint-disable-line no-unused-vars
  const dates = confirmedDates && typeof confirmedDates === 'object' ? confirmedDates : {};
  const out = [];
  for (const row of Array.isArray(list) ? list : []) {
    if (!row || row.verified === false || typeof row.id !== 'string' || !row.id.startsWith('intl-')) continue;
    const confirmed = dates[row.id] || {};
    out.push({
      id: row.id,
      source: 'curated',
      pinned: false,
      title: row.name || '',
      host: row.host || '',
      tier: 'international',
      url: httpsUrl(row.url),
      format: 'curated',
      format_kind: row.kind === 'case' ? 'case' : 'other',
      is_case: row.kind === 'case',
      kind: row.kind,
      team_max: teamMax(row.team_size),
      regn_close: isoOrNull(confirmed.regn_close),
      comp_end: isoOrNull(confirmed.comp_end),
      expected: { application_months: row.application_months ?? null, finals_months: row.finals_months ?? null },
      intl: {
        entry: row.entry ?? null,
        entry_note: row.entry_note ?? null,
        who_applies: row.who_applies ?? null,
        indian_ug: row.indian_ug ?? null,
        indian_ug_note: row.indian_ug_note ?? null,
        fee: row.fee ?? null,
        last_edition: row.last_edition ?? null,
        watch_url: httpsUrl(row.watch_url),
      },
      verdict: curatedVerdict(row),
    });
  }
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIndex = name => MONTHS.indexOf(String(name).slice(0, 3).toLowerCase());
const DEADLINE = /deadline\s*:?\s*(?:[A-Za-z]+day,?\s*)?(?:([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})|(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{4}))/i;

// The first "Deadline: <date>" in the text, as YYYY-MM-DD, or null.
export function parseDeadline(text) {
  const m = String(text || '').match(DEADLINE);
  if (!m) return null;
  const [mon, day, year] = m[1] ? [m[1], m[2], m[3]] : [m[5], m[4], m[6]];
  const mi = monthIndex(mon);
  if (mi < 0) return null;
  const iso = `${year}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return validDate(iso) ? iso : null;
}

const RECENT_DAYS = 30;

// WordPress posts from Opportunity Desk. The body is read for the deadline
// and then dropped: it carries organisers' contact details.
export function oppdeskRecords(posts, today) {
  const out = [];
  for (const p of Array.isArray(posts) ? posts : []) {
    if (!p || !Number.isInteger(p.id) || p.id <= 0) continue;
    const url = httpsUrl(p.link);
    if (!url) continue;
    const title = stripHtml(p.title?.rendered ?? '');
    if (!title || !isCaseTitle(title)) continue;
    const regn = parseDeadline(stripHtml(p.content?.rendered ?? ''));
    if (!regn || dayDiff(regn, today) > RECENT_DAYS) continue;
    out.push({
      id: `od-${p.id}`,
      source: 'oppdesk',
      pinned: false,
      title,
      host: 'Opportunity Desk listing',
      tier: 'international',
      url,
      format: 'oppdesk',
      format_kind: 'case',
      is_case: true,
      kind: 'case',
      team_max: null,
      regn_close: regn,
      comp_end: null,
      verdict: { level: 'check', reasons: ['verify eligibility on the post'] },
    });
  }
  return out;
}
