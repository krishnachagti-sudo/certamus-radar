// The two sections of the site, case comps (default) and hackathons (?s=hack):
// which curated files each reads, its wording, tiers and eligibility rule table,
// and the link builder that keeps every internal link in its section.
// Browser-safe and pure apart from currentSection(), which reads location.
import { TIERS, BOARD_TIERS } from './data.js';
import { eligibilityRows, hackEligibilityRows } from './eligibility.js';

export const HACK_TIERS = {
  iit: 'IIT', iim: 'IIM', national: TIERS.national, bschool: TIERS.bschool,
  corporate: 'Corporate', global: 'Global online & abroad', other: 'Other',
};
export const HACK_BOARD_TIERS = ['iit', 'iim', 'national', 'bschool', 'corporate', 'global'];

const ALL_TIER_LABELS = { ...TIERS, ...HACK_TIERS };
export const tierLabel = t => ALL_TIER_LABELS[t] || t;

const SITE = 'Certamus Radar';

export const SECTIONS = {
  case: {
    key: 'case', noun: 'case comp', plural: 'case comps', switchLabel: 'Case comps',
    // Listings, status and archive are Supabase rows of this section (lib/store.js);
    // the curated lists are public config in ./data/.
    files: { curated: ['international.json', 'fests.json'] },
    tiers: TIERS, boardTiers: BOARD_TIERS, eligibilityRows,
    otherFormatsLabel: 'Quizzes and other formats', abroadToggle: false, allowAdd: true,
    pages: {
      board: { title: SITE, h1: SITE },
      all: { title: `All case comps · ${SITE}`, h1: 'All case comps' },
      calendar: { title: `Calendar · ${SITE}` },
      hosts: { title: `Hosts & archive · ${SITE}`, h1: 'Hosts & archive' },
    },
  },
  hack: {
    key: 'hack', noun: 'hackathon', plural: 'hackathons', switchLabel: 'Hackathons',
    files: { curated: ['hack-curated.json'] },
    tiers: HACK_TIERS, boardTiers: HACK_BOARD_TIERS, eligibilityRows: hackEligibilityRows,
    otherFormatsLabel: 'Other formats', abroadToggle: true, allowAdd: false,
    pages: {
      board: {
        title: `Hackathons · ${SITE}`, h1: 'Hackathons',
        intro: 'Open hackathons and ideathons from Unstop, Devfolio, MLH and Devpost, plus curated national and corporate hackathons, checked against Krishna and Akshit’s team. In-person events abroad are hidden unless you include them.',
      },
      all: {
        title: `All hackathons · ${SITE}`, h1: 'All hackathons',
        intro: 'Every hackathon and ideathon from every source and host, sorted by deadline. Coding contests, CTFs, datathons and quizzes sit behind “Other formats”.',
      },
      calendar: { title: `Calendar (hackathons) · ${SITE}` },
      hosts: {
        title: `Hackathon hosts & archive · ${SITE}`, h1: 'Hackathon hosts & archive',
        intro: 'Every hackathon host seen on the radar, and every hackathon that has closed.',
      },
    },
  },
};

// Ids only the hackathon sources use: a competition link that lost its
// section still opens in the right one.
const HACK_ID = /^(df|mlh|dp|hk)-/;

export function sectionFrom(search) {
  const p = new URLSearchParams(typeof search === 'string' ? search : '');
  const s = p.get('s');
  if (s === 'hack') return 'hack';
  if (s == null || s === '') return HACK_ID.test(p.get('id') || '') ? 'hack' : 'case';
  return 'case';
}

export const currentSection = () => sectionFrom(globalThis.location?.search);
export const sectionOf = key => SECTIONS[key === 'hack' ? 'hack' : 'case'];
export const otherSection = key => (key === 'hack' ? 'case' : 'hack');

// 'index.html' for case comps (links stay as they were), 'index.html?s=hack'.
export const pageHref = (file, section) => (section === 'hack' ? `${file}?s=hack` : file);
