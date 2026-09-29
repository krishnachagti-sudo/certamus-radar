// Unstop's public JSON (undocumented; verified 2026-09-29). Search items carry
// the same `details` HTML as the detail endpoint, so a search-built record is
// already complete; the detail endpoint is only needed for manually added ids
// that don't come back from search.
import { istDate } from '../dates.js';

const BASE = 'https://unstop.com/api/public';
const PER_PAGE = 30;
// A full scan of every open competition: 673 listings on 23 pages on
// 2026-09-30. 60 pages leaves room for the busy season.
const MAX_PAGES = 60;
export const UA = 'CertamusRadar/1.0 (+https://github.com/krishnachagti-sudo/certamus-radar)';

const searchUrl = page =>
  `${BASE}/opportunity/search-result?opportunity=competitions&oppstatus=open&per_page=${PER_PAGE}&page=${page}`;
const detailUrl = id => `${BASE}/competition/${id}`;

export async function defaultGetJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
// Plain-text GET with the same UA, for HTML pages (watcher, InsideIIM).
export async function defaultGetText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}
export const defaultPause = () => new Promise(r => setTimeout(r, 1000));

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

// ---- format classes ----------------------------------------------------------
// format_kind is 'case', 'business' or 'other'; is_case (kept for older
// readers) means "belongs on the main list": format_kind !== 'other'.
// Rules read the Unstop type/subtype, the title and, for the B-school lean,
// the host name. Never the body text. Tuned on the 661 open listings of
// 2026-09-30: err toward inclusion for business-ish titles at B-schools,
// toward exclusion for tech fests' coding and robotics.

// A written-only or quiz format rules out even a case_competition subtype.
const CASE_FALSE_TITLE = /\bquiz|call for (articles|papers)|article writing|essay|\bprompt\b/i;
const CASE_TRUE_TITLE = /\bcase|consult|strateg|teardown|war room|\bL\.?I\.?M\.?E\b|crucible/i;
// Tech-fest and admin formats: never business, whatever the host.
const TECH_TITLE = new RegExp([
  'hack(athon)?\\b', 'buildathon', '\\w+-?a-?thon\\b(?<!(ide|pitch|biz|market|sell|fin|business)-?a-?thon)',
  'coding', '\\bcode\\b', 'programming', '\\bCTF\\b', 'capture the flag', 'game ?jam', 'game dev', 'robo',
  '\\bbots?\\b', '\\bdrones?\\b', '\\bUAV', '\\bRC\\b', 'aeromodel', '\\bCAD\\b', 'olympiad',
  'bootcamp', '\\bcourse\\b', 'workshop', 'webinar',
  // Event passes: "Gold Pass", "General Event Pass", "School Student Pass".
  '\\b(event|gold|silver|platinum|diamond|general|student|fest|day|entry|all[- ]access|combo|vip)\\s+pass(es)?\\b',
  '\\bpass(es)?\\s*$',
].join('|'), 'i');
// Cultural and sports formats: out unless the title is also business-flavoured.
const SOFT_OTHER_TITLE = /research (conclave|paper|poster)|paper presentation|poster|photo|\bfilm|dance|music|singing|cultural|\bsports?\b|cricket|football|chess|e-?sports|gaming|\bBGMI\b|valorant/i;
const BUSINESS_TITLE = new RegExp([
  'b-?plan', 'business', '\\bbiz', 'pitch', 'ideathon', '\\bbid(ding)?\\b', 'auction', 'marketing', '\\bbrand',
  'financ', 'fintech', 'invest', 'portfolio', 'stock', 'trading', '\\btrader', 'equity', '\\bM&A\\b', 'merger',
  '\\bHR\\b', 'human resource', 'industrial relations', 'operations', '\\bops\\b', 'supply chain', 'policy',
  'product management', '\\bproduct\\b', 'analytics challenge', 'preneur', 'start-?up', 'venture',
  'sustainability solutions', 'tycoon', 'manager', 'monopoly', 'bargain', 'negotiat', '\\bbanks?\\b', 'banking',
  'credit', 'econom', 'valuation', '\\bsales\\b', 'shark tank', '\\btank\\b',
].join('|'), 'i');
// "At a B-school": a management, business or commerce school by name.
const MGMT_HOST = /management|business|commerce|\bIIM\b|XLRI|\bIIFT\b|foreign trade|\bMICA\b|\bISB\b|\bMBA\b|\bPGDM\b/i;
const FLAGSHIP = /flagship/i;

// The title-only half of the case rule, shared with the Opportunity Desk adapter.
export function isCaseTitle(title) {
  return !CASE_FALSE_TITLE.test(title) && CASE_TRUE_TITLE.test(title);
}

export function formatKind({ type, subtype, title, host }) {
  title = title || '';
  if (type === 'quizzes' || type === 'hackathons' || subtype === 'online_coding_challenge') return 'other';
  if (CASE_FALSE_TITLE.test(title)) return 'other';
  if (subtype === 'case_competition' || CASE_TRUE_TITLE.test(title)) return 'case';
  if (TECH_TITLE.test(title)) return 'other';
  if (BUSINESS_TITLE.test(title)) return 'business';
  if (SOFT_OTHER_TITLE.test(title)) return 'other';
  const bschool = MGMT_HOST.test(host || '');
  if (bschool && FLAGSHIP.test(title)) return 'business';
  // Any other competition at a management school leans in (innovation
  // challenges there too); elsewhere an unnamed format stays out.
  if (bschool) return 'business';
  return 'other';
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
  const kind = formatKind({ type: src.type, subtype: src.subtype, title: src.title, host: src.organisation?.name });
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
    format_kind: kind,
    is_case: kind !== 'other',
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

  // One scan of every open competition, paged by last_page. No keyword
  // filter: real case competitions have titles with none of our words.
  const items = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    let body;
    try {
      body = await getSearch(searchUrl(page));
    } finally {
      await pause();
    }
    const list = body?.data?.data;
    if (!Array.isArray(list)) throw new Error(`Unstop search shape changed (page ${page})`);
    for (const it of list) {
      if (validItem(it)) items.set(it.id, it);
      else warnings.push(`skipped malformed item ${it?.id ?? '?'}`);
    }
    const rawLastPage = body.data.last_page;
    if (list.length > 0 && (rawLastPage === undefined || rawLastPage === null)) {
      warnings.push(`no last_page; stopped at page ${page}`);
      break;
    }
    // Unstop pages can come back short (29 of 30) with more pages left, so
    // page by last_page, never by page length. Verified 2026-09-29.
    const lastPage = Number(rawLastPage) || page;
    if (page === 1 && lastPage > MAX_PAGES) warnings.push(`last_page ${lastPage} exceeds MAX_PAGES ${MAX_PAGES}`);
    if (list.length === 0 || page >= lastPage) break;
  }
  if (items.size === 0) throw new Error('Unstop search returned no competitions');

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
