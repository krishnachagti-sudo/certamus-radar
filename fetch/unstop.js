// Unstop's public JSON (undocumented; verified 2026-09-29). Search pages give
// the listing fields; the detail page is a superset that adds the body text.
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

export function stripHtml(html) {
  return String(html || '')
    .replace(/<(br|\/p|\/li|\/div|\/h\d)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim();
}

// `src` is a search item or a detail competition (same field names, except
// isPaid vs paid). `detail` is the detail competition, or null if not fetched.
export function normalise(src, detail) {
  const r = src.regnRequirements || {};
  let eligibility = null;
  try { eligibility = r.eligibility ? JSON.parse(r.eligibility) : null; } catch { eligibility = null; }
  const num = x => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null);
  return {
    id: src.id,
    pinned: false,
    unstop_updated_at: src.updated_at || null,
    end_date_raw: src.end_date || null,
    regn_end_raw: r.end_regn_dt || null,
    url: src.seo_url || `https://unstop.com/competitions/${src.id}`,
    title: src.title || '',
    host: src.organisation?.name || '',
    regn_close: istDate(r.end_regn_dt || src.end_date),
    comp_end: istDate(detail?.end_date || src.end_date),
    mode: src.region === 'offline' ? 'offline' : 'online',
    fee: Boolean(src.isPaid ?? src.paid),
    team_min: num(r.min_team_size),
    team_max: num(r.max_team_size),
    prize_total: (src.prizes || []).reduce((s, p) => s + (Number(p?.cash) || 0), 0),
    eligible_filters: (src.filters || []).filter(f => f.type === 'eligible').map(f => f.name),
    eligibility,
    details_text: detail ? stripHtml(detail.details) : '',
    details_fetched: Boolean(detail),
  };
}

const validItem = it => it && it.id && it.title && it.organisation && it.regnRequirements;

export async function fetchAll(existingById, manualIds, opts) {
  const getJson = opts.getJson || defaultGetJson;
  const pause = opts.pause || defaultPause;
  const wantDetail = opts.wantDetail || (() => true);
  const warnings = [];

  const items = new Map();
  for (const term of opts.keywords) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const body = await getJson(searchUrl(term, page));
      await pause();
      const list = body?.data?.data;
      if (!Array.isArray(list)) throw new Error(`Unstop search shape changed (term "${term}")`);
      for (const it of list) {
        if (validItem(it)) items.set(it.id, it);
        else warnings.push(`skipped malformed item ${it?.id ?? '?'}`);
      }
      // Unstop pages can come back short (29 of 30) with more pages left, so
      // page by last_page, never by page length. Verified 2026-09-29.
      const lastPage = Number(body.data.last_page) || page;
      if (list.length === 0 || page >= lastPage) break;
    }
  }
  if (items.size === 0) throw new Error('Unstop search returned no competitions for any keyword');

  const detail = async id => {
    try {
      const body = await getJson(detailUrl(id));
      await pause();
      const c = body?.data?.competition;
      if (!c || !c.id) throw new Error('detail shape changed');
      return c;
    } catch (e) {
      warnings.push(`detail ${id}: ${e.message}`);
      return null;
    }
  };

  const records = [];
  for (const it of items.values()) {
    const prev = existingById.get(it.id);
    const changed = !prev
      || prev.unstop_updated_at !== (it.updated_at || null)
      || prev.end_date_raw !== (it.end_date || null)
      || prev.regn_end_raw !== (it.regnRequirements?.end_regn_dt || null);
    const want = manualIds.includes(it.id) || (wantDetail(it) && (changed || !prev?.details_fetched));
    const d = want ? await detail(it.id) : null;
    const rec = normalise(it, d);
    if (!d && prev) {
      rec.details_text = prev.details_text || '';
      rec.details_fetched = Boolean(prev.details_fetched);
      rec.comp_end = prev.comp_end || rec.comp_end;
    }
    records.push(rec);
  }

  for (const id of manualIds) {
    if (items.has(id)) continue;
    const d = await detail(id);
    if (d) records.push(normalise(d, d));
    else if (existingById.has(id)) records.push(existingById.get(id));
  }

  for (const r of records) r.pinned = manualIds.includes(r.id);
  return { records, warnings };
}
