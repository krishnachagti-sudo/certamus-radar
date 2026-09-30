// Major League Hacking: the current season's events page
// (https://www.mlh.com/seasons/<year>/events; mlh.io redirects there).
// robots.txt allows it. The page is an Inertia app: the event list is the
// JSON in <script data-page="app">, props.upcomingEvents. One fetch per run.
import { defaultGetText, defaultPause } from './unstop.js';
import { istDate } from '../dates.js';
import { httpsUrl } from '../urls.js';

// MLH seasons run August to July and are named for the year they end in:
// the 2027 season starts in August 2026.
export function mlhSeason(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  return ist.getUTCMonth() >= 7 ? ist.getUTCFullYear() + 1 : ist.getUTCFullYear();
}
export const mlhUrl = season => `https://www.mlh.com/seasons/${season}/events`;

export async function fetchMlh({ getText = defaultGetText, pause = defaultPause, now = new Date() } = {}) {
  try {
    return await getText(mlhUrl(mlhSeason(now)));
  } finally {
    await pause();
  }
}

const decode = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// HTML -> upcoming events. Throws when the payload is missing (a shape
// change, not an empty season).
export function parseMlh(html) {
  const m = String(html || '').match(/<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/)
    || String(html || '').match(/<div[^>]*id="app"[^>]*data-page="([^"]*)"/);
  if (!m) throw new Error('MLH page shape changed (no data-page payload)');
  let page;
  try { page = JSON.parse(m[1].trim().startsWith('{') ? m[1] : decode(m[1])); } catch (e) { throw new Error(`MLH page shape changed (${e.message})`); }
  const events = page?.props?.upcomingEvents;
  if (!Array.isArray(events)) throw new Error('MLH page shape changed (no upcomingEvents)');
  return events;
}

const MODES = { physical: 'offline', hybrid_physical: 'hybrid' };
const SLUG = /^[a-z0-9][a-z0-9_-]*$/i;

export function mlhRecords(events) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e.slug !== 'string' || !SLUG.test(e.slug) || typeof e.name !== 'string' || !e.name.trim()) continue;
    const mode = MODES[e.formatType] || 'online';
    const country = typeof e.venueAddress?.country === 'string' ? e.venueAddress.country : null;
    const types = Array.isArray(e.customFields?.underserved_types) ? e.customFields.underserved_types : [];
    const page = typeof e.url === 'string' && e.url.startsWith('/') ? `https://www.mlh.com${e.url}` : null;
    const url = httpsUrl(e.websiteUrl) || httpsUrl(page);
    if (!url) continue;
    out.push({
      id: `mlh-${e.slug.toLowerCase()}`,
      source: 'mlh',
      pinned: false,
      url,
      title: e.name.trim(),
      host: 'MLH member event',
      location: mode === 'online' ? 'Online' : (typeof e.location === 'string' ? e.location.trim() : null),
      country,
      // MLH lists no registration deadline; registration shuts by the start.
      regn_close: istDate(e.startsAt),
      comp_start: istDate(e.startsAt),
      comp_end: istDate(e.endsAt),
      mode,
      fee: false,
      team_min: null,
      team_max: null,
      prize_total: null,
      format: 'mlh',
      facts: {
        stated: false,
        school_only: types.includes('High School Students Only'),
        women_only: types.includes('Women Only'),
        abroad: mode !== 'online' && country && country !== 'IN' ? country : null,
      },
    });
  }
  return out;
}
