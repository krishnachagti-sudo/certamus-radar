// InsideIIM competitions (https://insideiim.com/competitions). A Next.js app
// router page: the listing is embedded in the HTML as a React flight payload
// (self.__next_f.push). robots.txt allows / and disallows /api/, so this
// fetches that one page, once per run, and nothing else. Optional source:
// run.js treats a failure here as a warning, not a failed run.
//
// Descriptions and eligibility text are read here only to set two flags
// (says_case, open_to_all) and are never returned: listings carry organisers'
// emails and phone numbers, and the published file is public.
import { defaultGetText, defaultPause } from './unstop.js';
import { dayDiff, istDate } from '../dates.js';
import { httpsUrl } from '../urls.js';

export const INSIDEIIM_URL = 'https://insideiim.com/competitions';
// InsideIIM's own competition pages live on insidekampus.com (the site's
// card component links ONAPP listings there; verified 2026-09-30).
const DETAIL_BASE = 'https://insidekampus.com/competition/';
const INSIDE_HOST = /(^|\.)(insideiim|insidekampus)\.com$/i;

export async function fetchInsideIim({ getText = defaultGetText, pause = defaultPause } = {}) {
  try {
    return await getText(INSIDEIIM_URL);
  } finally {
    await pause();
  }
}

// ---- flight payload ---------------------------------------------------------

// The concatenated flight text from every self.__next_f.push([1, "..."]).
function flightText(html) {
  const re = /self\.__next_f\.push\((\[[\s\S]*?\])\)\s*<\/script>/g;
  let out = '';
  let m;
  while ((m = re.exec(html))) {
    try {
      const a = JSON.parse(m[1]);
      if (a[0] === 1 && typeof a[1] === 'string') out += a[1];
    } catch { /* not a data chunk */ }
  }
  return out;
}

// Flight rows: `<hex id>:<json>\n`, or `<hex id>:T<hex byte length>,<text>`
// (no newline; the length is in UTF-8 bytes). Tagged rows (I, HL...) are
// skipped. Returns { rows: Map(id -> text), values: [parsed json rows] }.
function flightRows(text) {
  const buf = Buffer.from(text, 'utf8');
  const rows = new Map();
  const values = [];
  let i = 0;
  while (i < buf.length) {
    const colon = buf.indexOf(0x3a, i);
    if (colon < 0) break;
    const id = buf.toString('utf8', i, colon);
    if (!/^[0-9a-f]*$/.test(id)) {
      const nl = buf.indexOf(0x0a, i);
      if (nl < 0) break;
      i = nl + 1;
      continue;
    }
    if (buf[colon + 1] === 0x54) { // 'T'
      const comma = buf.indexOf(0x2c, colon + 2);
      const len = parseInt(buf.toString('utf8', colon + 2, comma), 16);
      if (comma < 0 || !Number.isInteger(len)) break;
      rows.set(id, buf.toString('utf8', comma + 1, comma + 1 + len));
      i = comma + 1 + len;
      continue;
    }
    let nl = buf.indexOf(0x0a, colon + 1);
    if (nl < 0) nl = buf.length;
    try {
      values.push(JSON.parse(buf.toString('utf8', colon + 1, nl)));
    } catch { /* tagged or non-JSON row */ }
    i = nl + 1;
  }
  return { rows, values };
}

function nextData(html) {
  const m = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try { return [JSON.parse(m[1])]; } catch { return []; }
}

const isComp = o => o && typeof o === 'object' && !Array.isArray(o)
  && typeof o._id === 'string' && typeof o.slug === 'string' && typeof o.title === 'string'
  && typeof o.status === 'string' && 'registrationEnd' in o;

function collect(value, out, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 60) return;
  if (isComp(value)) { if (!out.has(value._id)) out.set(value._id, value); return; }
  for (const v of Array.isArray(value) ? value : Object.values(value)) collect(v, out, depth + 1);
}

// ---- items ------------------------------------------------------------------

const plain = html => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
const CASE_DESC = /\bcase[- ]?(stud|competition|challenge|round|solv|submission|analys|deck|problem|based)/i;
const OPEN_TO_ALL = /\bopen to all\b|\bopen to (students|candidates) (of|from) (all|any)\b|\bstudents of any (discipline|college|institute)/i;

function detailUrl(c) {
  if (c.type === 'EXTERNAL' && typeof c.externalLink === 'string') {
    const u = httpsUrl(c.externalLink);
    if (u && INSIDE_HOST.test(new URL(u).hostname)) return u;
  }
  return `${DETAIL_BASE}${encodeURIComponent(c.slug)}`;
}

// HTML -> ACTIVE competitions: { id, slug, title, host, status, deadline,
// url, campuses, says_case, open_to_all }. Throws when the page carries no
// competitions at all (a shape change, not an empty season).
export function parseInsideIim(html) {
  html = String(html || '');
  const { rows, values } = flightRows(flightText(html));
  const deref = v => (typeof v === 'string' && /^\$[0-9a-f]+$/.test(v) && typeof rows.get(v.slice(1)) === 'string' ? rows.get(v.slice(1)) : v);
  const found = new Map();
  for (const v of [...values, ...nextData(html)]) collect(v, found);
  if (!found.size) throw new Error('InsideIIM page shape changed (no competitions found)');
  const items = [];
  for (const c of found.values()) {
    if (c.status !== 'ACTIVE') continue;
    const campuses = (Array.isArray(c.campuses) ? c.campuses : [])
      .map(x => x?.campus?.name ?? x?.name).filter(n => typeof n === 'string' && n.trim()).map(n => n.trim());
    items.push({
      id: c._id,
      slug: c.slug,
      title: c.title.trim(),
      host: typeof c.organization?.name === 'string' ? c.organization.name.trim() : '',
      status: c.status,
      deadline: typeof c.registrationEnd === 'string' ? c.registrationEnd : null,
      url: detailUrl(c),
      campuses,
      says_case: CASE_DESC.test(plain(deref(c.description))),
      open_to_all: OPEN_TO_ALL.test(plain(deref(c.eligibility))),
    });
  }
  return items;
}

// ---- records ----------------------------------------------------------------

const tokens = s => String(s).toLowerCase().match(/[a-z0-9]+/g) || [];

// "Reckitt DARE 2026 - IIM Bangalore" with campus "Indian Institute of
// Management, Bangalore (IIM)" is a per-campus round: host "Reckitt – IIM
// Bangalore". The title's last segment counts only if every word of it
// appears in the campus names.
function hostOf(it) {
  const org = it.host || 'InsideIIM';
  const campuses = it.campuses || [];
  if (!campuses.length) return org;
  const seg = it.title.split(/\s[-–—]\s/);
  if (seg.length > 1) {
    const last = seg[seg.length - 1].trim();
    const words = new Set(campuses.flatMap(tokens));
    if (last && tokens(last).every(w => words.has(w))) return `${org} – ${last}`;
  }
  return campuses.length === 1 ? `${org} – ${campuses[0]}` : org;
}

function verdictOf(it) {
  const campuses = it.campuses || [];
  if (campuses.some(n => /sirmaur/i.test(n))) return { level: 'fits', reasons: [] };
  if (campuses.length) return { level: 'check', reasons: ['Campus-restricted: check whether IIM Sirmaur is an eligible campus'] };
  if (it.open_to_all) return { level: 'fits', reasons: [] };
  return { level: 'check', reasons: ['Eligibility on InsideIIM'] };
}

// Items -> competition records. A listing whose deadline has passed is left
// out (InsideIIM keeps closed rounds ACTIVE for months); a record seen open
// on an earlier run and missing now is closed by merge as usual.
export function insideiimRecords(items, today) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it.id !== 'string' || !it.id || typeof it.title !== 'string' || !it.title) continue;
    const url = httpsUrl(it.url);
    if (!url) continue;
    const regn = istDate(it.deadline);
    if (regn && dayDiff(today, regn) < 0) continue;
    const kind = it.says_case || /\bcase/i.test(it.title) ? 'case' : 'business';
    out.push({
      id: `iim-${it.id}`,
      source: 'insideiim',
      pinned: false,
      title: it.title,
      host: hostOf(it),
      tier: 'corporate',
      url,
      format: 'insideiim',
      format_kind: kind,
      is_case: true,
      kind,
      team_max: null,
      regn_close: regn,
      comp_end: null,
      verdict: verdictOf(it),
    });
  }
  return out;
}
