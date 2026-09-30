// Devfolio's public search API (robots.txt allows everything; verified
// 2026-09-30). One POST per page of 50 open hackathons. Descriptions and FAQ
// answers are read for three booleans (eligibility stated, same-college,
// women-only) and never returned: FAQs and settings carry organisers'
// emails, and participant/judge details carry names.
import { defaultPostJson, defaultPause } from './unstop.js';
import { IS_COLLEGE } from './classify.js';
import { sameCollege, womenOnly } from './hack-classify.js';
import { istDate } from '../dates.js';

export const DEVFOLIO_URL = 'https://api.devfolio.co/api/search/hackathons';
const PAGE = 50;
const MAX_PAGES = 10;

export async function fetchDevfolio({ postJson = defaultPostJson, pause = defaultPause } = {}) {
  const hits = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let body;
    try {
      body = await postJson(DEVFOLIO_URL, { type: 'application_open', from: page * PAGE, size: PAGE });
    } finally {
      await pause();
    }
    const list = body?.hits?.hits;
    if (!Array.isArray(list)) throw new Error(`Devfolio search shape changed (page ${page + 1})`);
    hits.push(...list.map(h => h?._source).filter(Boolean));
    const total = Number(body.hits.total?.value ?? body.hits.total);
    if (list.length < PAGE || !Number.isFinite(total) || hits.length >= total) break;
  }
  return hits;
}

const UUID = /^[0-9a-f]{32}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]*$/i;
const WHO = /who can|eligib|participate|apply/i;
const INDIA = /^india$/i;
const num = x => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : null);

// The organiser: hosted_by when set (rarely), else the venue's first segment
// when it names an institution ("NIT Raipur, Great Eastern Road, ..."), so
// the institute tiers can apply. Never the rest of the street address.
function hostOf(s) {
  const hb = typeof s.hosted_by === 'string' ? s.hosted_by : s.hosted_by?.name;
  if (typeof hb === 'string' && hb.trim()) return hb.trim();
  const first = String(s.location || '').split(',')[0].trim();
  return first && IS_COLLEGE.test(first) ? first : '';
}

export function devfolioRecords(hits) {
  const out = [];
  for (const s of Array.isArray(hits) ? hits : []) {
    if (!s || typeof s.uuid !== 'string' || !UUID.test(s.uuid) || typeof s.slug !== 'string' || !SLUG.test(s.slug)) continue;
    if (typeof s.name !== 'string' || !s.name.trim()) continue;
    const setting = s.hackathon_setting || {};
    const faqs = Array.isArray(s.hackathon_faqs) ? s.hackathon_faqs : [];
    const faqText = faqs.map(f => `${f?.question ?? ''}. ${f?.answer ?? ''}`).join('\n');
    const country = typeof s.country === 'string' && s.country.trim() ? s.country.trim() : null;
    const online = s.is_online === true;
    out.push({
      id: `df-${s.uuid.toLowerCase()}`,
      source: 'devfolio',
      pinned: false,
      // Verified 2026-09-30: every listing lives at https://<slug>.devfolio.co/.
      url: `https://${s.slug.toLowerCase()}.devfolio.co/`,
      title: s.name.trim(),
      host: hostOf(s),
      location: online ? 'Online' : [s.city, country].filter(x => typeof x === 'string' && x.trim()).join(', ') || null,
      country,
      regn_close: istDate(setting.reg_ends_at || s.starts_at),
      comp_start: istDate(s.starts_at),
      comp_end: istDate(s.ends_at),
      mode: online ? 'online' : 'offline',
      fee: false,
      team_min: num(s.team_min),
      team_max: num(s.team_size),
      prize_total: null,
      format: 'devfolio',
      facts: {
        stated: faqs.some(f => WHO.test(f?.question ?? '')),
        same_college: sameCollege(faqText),
        women_only: setting.women_only === true || womenOnly(faqText),
        abroad: !online && country && !INDIA.test(country) ? country : null,
      },
    });
  }
  return out;
}
