// Devpost's hackathon listing JSON (https://devpost.com/api/hackathons,
// status[]=open). robots.txt disallows only named bots; a plain JSON request
// returns JSON (verified 2026-09-30). Nine per page, paged by meta.total_count.
import { defaultGetJson, defaultPause } from './unstop.js';
import { httpsUrl } from '../urls.js';

export const devpostUrl = page => `https://devpost.com/api/hackathons?status%5B%5D=open&page=${page}`;
const MAX_PAGES = 20;

export async function fetchDevpost({ getJson = defaultGetJson, pause = defaultPause } = {}) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let body;
    try {
      body = await getJson(devpostUrl(page));
    } finally {
      await pause();
    }
    const list = body?.hackathons;
    if (!Array.isArray(list)) throw new Error(`Devpost shape changed (page ${page})`);
    all.push(...list);
    const total = Number(body.meta?.total_count);
    if (!list.length || !Number.isFinite(total) || all.length >= total) break;
  }
  return all;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const mi = s => MONTHS.indexOf(String(s).slice(0, 3).toLowerCase());
const iso = (y, m, d) => {
  const out = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const t = Date.parse(`${out}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === out ? out : null;
};

// "Jul 31 - Oct 01, 2026", "Oct 01 - 05, 2026", "Dec 15, 2026 - Jan 10, 2027",
// "Oct 01, 2026" -> the last date, as YYYY-MM-DD, or null.
export function parseDevpostEnd(text) {
  const parts = String(text || '').split(/\s+[-–]\s+/).map(s => s.trim());
  const last = parts[parts.length - 1];
  let m = last.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),\s*(\d{4})$/);
  if (m && mi(m[1]) >= 0) return iso(m[3], mi(m[1]), m[2]);
  m = last.match(/^(\d{1,2}),\s*(\d{4})$/);
  const first = parts.length > 1 ? parts[0].match(/^([A-Za-z]{3,})/) : null;
  if (m && first && mi(first[1]) >= 0) return iso(m[2], mi(first[1]), m[1]);
  return null;
}

const DEVPOST_HOST = /(^|\.)devpost\.com$/i;

export function devpostRecords(list) {
  const out = [];
  for (const h of Array.isArray(list) ? list : []) {
    if (!h || !Number.isInteger(h.id) || h.id <= 0 || typeof h.title !== 'string' || !h.title.trim()) continue;
    const url = httpsUrl(h.url);
    if (!url || !DEVPOST_HOST.test(new URL(url).hostname)) continue;
    const where = typeof h.displayed_location?.location === 'string' ? h.displayed_location.location.trim() : '';
    const online = h.displayed_location?.icon === 'globe' || /^online$/i.test(where);
    const end = parseDevpostEnd(h.submission_period_dates);
    out.push({
      id: `dp-${h.id}`,
      source: 'devpost',
      pinned: false,
      url,
      title: h.title.trim(),
      host: typeof h.organization_name === 'string' ? h.organization_name.trim() : '',
      location: online ? 'Online' : where || null,
      country: null,
      // Devpost's deadline is the submission deadline; registration stays open until then.
      regn_close: end,
      comp_start: null,
      comp_end: end,
      mode: online ? 'online' : 'offline',
      fee: false,
      team_min: null,
      team_max: null,
      prize_total: null,
      format: 'devpost',
      facts: {
        stated: false,
        abroad: !online && !/\bindia\b/i.test(where) ? (where || 'in person') : null,
        invite_only: h.invite_only === true,
      },
    });
  }
  return out;
}
