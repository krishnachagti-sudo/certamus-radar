// Unstop's public JSON (undocumented; verified 2026-09-29). Search items carry
// the same `details` HTML as the detail endpoint, so a search-built record is
// already complete; the detail endpoint is only needed for manually added ids
// that don't come back from search.
import { istDate } from '../dates.js';

const BASE = 'https://unstop.com/api/public';
const PER_PAGE = 30;
const MAX_PAGES = 10;
export const UA = 'CertamusRadar/1.0 (+https://github.com/krishnachagti-sudo/certamus-radar)';

const searchUrl = (term, page) =>
  `${BASE}/opportunity/search-result?opportunity=competitions&oppstatus=open&searchTerm=${encodeURIComponent(term)}&page=${page}&per_page=${PER_PAGE}`;
const detailUrl = id => `${BASE}/competition/${id}`;

async function defaultGetJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
const defaultPause = () => new Promise(r => setTimeout(r, 1000));

// A code point above 0x10FFFF is not decodable (String.fromCodePoint throws),
// so it degrades to a space rather than crashing the whole run.
const safeCodePoint = c => (c <= 0x10FFFF ? String.fromCodePoint(c) : ' ');

export function stripHtml(html) {
  const stripped = String(html || '')
    .replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const decoded = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&middot;/g, '·')
    .replace(/&hellip;/g, '…')
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&bull;/g, '•')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    // &amp; decodes last, so a double-escaped entity like &amp;lt; degrades
    // to the literal text "&lt;" instead of re-decoding into "<".
    .replace(/&amp;/g, '&');
  return decoded.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim();
}

const MODES = ['offline', 'hybrid', 'online'];

// A quiz/hackathon type or title, or a title naming a written-only format,
// rules out "case" regardless of subtype or the true-side title match.
const CASE_FALSE_TITLE = /\bquiz\b|call for (articles|papers)|article writing|essay|\bprompt\b/i;
const CASE_TRUE_TITLE = /\bcase|consult|strateg|teardown|war room|\bL\.?I\.?M\.?E\b|crucible/i;

function isCase(src, title) {
  if (src.type === 'quizzes' || src.type === 'hackathons') return false;
  if ((src.subtype || '') === 'online_coding_challenge') return false;
  if (CASE_FALSE_TITLE.test(title)) return false;
  if (src.subtype === 'case_competition') return true;
  return CASE_TRUE_TITLE.test(title);
}

// Only an https link on unstop.com is published; anything else (javascript:,
// another host) becomes the canonical listing url.
function safeUrl(seoUrl, id) {
  try {
    const u = new URL(seoUrl);
    if (u.protocol === 'https:' && (u.hostname === 'unstop.com' || u.hostname === 'www.unstop.com')) return u.href;
  } catch { /* fall through */ }
  return `https://unstop.com/competitions/${id}`;
}

// `src` is a search item or a detail competition (same field names, except
// isPaid vs paid); both shapes carry a `details` HTML field.
export function normalise(src) {
  const r = src.regnRequirements || {};
  let eligibility = null;
  if (r.eligibility && typeof r.eligibility === 'object') {
    eligibility = r.eligibility;
  } else if (typeof r.eligibility === 'string') {
    try { eligibility = JSON.parse(r.eligibility); } catch { eligibility = null; }
  }
  const num = x => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null);
  return {
    id: src.id,
    pinned: false,
    url: safeUrl(src.seo_url, src.id),
    title: src.title || '',
    host: src.organisation?.name || '',
    regn_close: istDate(r.end_regn_dt || src.end_date),
    comp_end: istDate(src.end_date),
    mode: MODES.includes(src.region) ? src.region : 'online',
    fee: src.isPaid === true || Number(src.isPaid ?? src.paid) > 0,
    team_min: num(r.min_team_size),
    team_max: num(r.max_team_size),
    prize_total: (src.prizes || []).reduce((s, p) => s + (Number(p?.cash) || 0), 0),
    eligible_filters: (src.filters || []).filter(f => f.type === 'eligible').map(f => f.name),
    eligibility,
    details_text: stripHtml(src.details),
    details_fetched: typeof src.details === 'string',
    format: src.subtype || src.type || null,
    is_case: isCase(src, src.title || ''),
  };
}

const validItem = it => it && Number.isInteger(it.id) && it.id > 0 && it.title && it.organisation && it.regnRequirements;

export async function fetchAll(existingById, manualIds, opts) {
  const getJson = opts.getJson || defaultGetJson;
  const pause = opts.pause || defaultPause;
  const backoff = opts.backoff ?? 3000;
  const warnings = [];
  manualIds = [...new Set(manualIds)];

  // One retry for search requests only: a single transient failure (a 503,
  // a timeout) must not fail the whole run. Detail calls are not retried.
  const getSearch = async url => {
    try {
      return await getJson(url);
    } catch {
      if (backoff > 0) await new Promise(r => setTimeout(r, backoff));
      return await getJson(url);
    }
  };

  const items = new Map();
  for (const term of opts.keywords) {
    let warnedMaxPages = false;
    for (let page = 1; page <= MAX_PAGES; page++) {
      let body;
      try {
        body = await getSearch(searchUrl(term, page));
      } finally {
        await pause();
      }
      const list = body?.data?.data;
      if (!Array.isArray(list)) throw new Error(`Unstop search shape changed (term "${term}")`);
      for (const it of list) {
        if (validItem(it)) items.set(it.id, it);
        else warnings.push(`skipped malformed item ${it?.id ?? '?'}`);
      }
      const rawLastPage = body.data.last_page;
      if (list.length > 0 && (rawLastPage === undefined || rawLastPage === null)) {
        warnings.push(`no last_page for ${term}; stopped at page ${page}`);
        break;
      }
      // Unstop pages can come back short (29 of 30) with more pages left, so
      // page by last_page, never by page length. Verified 2026-09-29.
      const lastPage = Number(rawLastPage) || page;
      if (lastPage > MAX_PAGES && !warnedMaxPages) {
        warnings.push(`last_page ${lastPage} exceeds MAX_PAGES for ${term}`);
        warnedMaxPages = true;
      }
      if (list.length === 0 || page >= lastPage) break;
    }
  }
  if (items.size === 0) throw new Error('Unstop search returned no competitions for any keyword');

  const detail = async id => {
    try {
      const body = await getJson(detailUrl(id));
      const c = body?.data?.competition;
      if (!c || !Number.isInteger(c.id)) throw new Error('detail shape changed');
      return c;
    } catch (e) {
      warnings.push(`detail ${id}: ${e.message}`);
      return null;
    } finally {
      await pause();
    }
  };

  const records = [];
  for (const it of items.values()) {
    records.push(normalise(it));
  }

  for (const id of manualIds) {
    if (items.has(id)) continue;
    const d = await detail(id);
    if (d) records.push(normalise(d));
    // The stored record has no body text (it is never published), so it can't
    // be reclassified: run.js carries its tier and verdict over as-is.
    else if (existingById.has(id)) records.push({ ...existingById.get(id), carried_over: true });
  }

  for (const r of records) r.pinned = manualIds.includes(r.id);
  return { records, warnings };
}
