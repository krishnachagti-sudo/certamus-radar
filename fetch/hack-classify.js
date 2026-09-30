// Hackathons: format kind, tier and eligibility verdict. Pure: lists and team
// are arguments, so nothing here reads data/. Body text and FAQ answers are
// read here to derive a few booleans and are never returned or stored.
import { tier as instituteTier, courses, courseNames, COURSE_LISTS, BSCHOOL_OPEN, BSCHOOL_UG } from './classify.js';

// ---- kinds ------------------------------------------------------------------------
// 'build' (hackathons, buildathons, make-a-thons, game jams), 'ideathon'
// (ideathons, pitch / B-plan / startup / innovation challenges) or 'other'
// (coding contests, CTFs, Kaggle-style data competitions, quizzes, robotics,
// esports, posters, event passes, and titles that say nothing). 'other' stays
// in hackathons.json but off the main list: see README "Hackathons data".

const OTHER_TITLE = new RegExp([
  '\\bCTF\\b', 'capture the flag', 'bug bounty', 'red team', 'blue team',
  'coding (contest|challenge|competition)', 'programming (contest|league|olympiad|challenge)', 'competitive programming',
  '\\bCP contest', '\\bcode ?(clash|sprint|yudh|apex|avengers|rumble|slayer|voyage|wars?)\\b', 'olympiad',
  'datathon', 'kaggle', 'data (science )?(challenge|competition)',
  '\\bquiz', 'robo', 'pokerbot', '\\bbots?\\b', '\\bdrones?\\b', '\\bUAV\\b', 'line follower', '\\bLFR\\b',
  'valorant', '\\bBGMI\\b', 'e-?sports', 'tournament', 'poster', '\\bmath',
  '\\b(event|gold|silver|platinum|general|student|fest|entry|vip)\\s+pass(es)?\\b', '\\bpass(es)?\\s*$',
].join('|'), 'i');
const IDEATHON_WORD = /ideathon|growth hack|(start-?up|pitch|biz|business)-?a-?thon/i;
const BUILD_TITLE = /hack|\bbuild\b|buildathon|make-?a-?thon|space apps|game ?jam|\w+-?a-?thon\b/i;
const IDEA_TITLE = /\bideas?\b|\bpitch|b-?plan|business plan|start-?up|venture|innovation challenge|\bcase\b|product challenge|impact challenge/i;
const BODY_OTHER = /capture the flag|\bCTF\b|competitive programming|coding contest/i;
const PLATFORMS = new Set(['devfolio', 'mlh', 'devpost']);

export function hackKind({ title, body, source }) {
  title = String(title || '');
  if (OTHER_TITLE.test(title)) return 'other';
  if (IDEATHON_WORD.test(title)) return 'ideathon';
  if (BUILD_TITLE.test(title)) return 'build';
  if (IDEA_TITLE.test(title)) return 'ideathon';
  // A title that says nothing: hackathon platforms list hackathons; an
  // Unstop "hackathons" listing is often a coding contest, so read the body.
  if (PLATFORMS.has(source)) return 'build';
  const text = String(body || '');
  if (BODY_OTHER.test(text)) return 'other';
  if (/\bideathon/i.test(text)) return 'ideathon';
  if (/\bhackathon/i.test(text)) return 'build';
  return 'other';
}

// ---- tiers ------------------------------------------------------------------------
// iit / iim / national / bschool / corporate / other as for case comps (with
// the hackathon corporates list), plus global: MLH, Devpost, and any host
// outside India.
const INDIA = /^(india|in)$/i;

export function hackTier(rec, lists) {
  if (rec.source === 'mlh' || rec.source === 'devpost') return 'global';
  if (rec.country && !INDIA.test(String(rec.country).trim())) return 'global';
  return instituteTier(rec, lists);
}

// ---- eligibility facts from text (booleans only) ----------------------------------

const SAME_COLLEGE = [
  /\b(same|single) (college|institut\w*|university|campus|organi[sz]ation)\b/i,
  /\b(cross|inter)[- ]?(college|institut\w*|university)\s+teams?\b[^.]{0,20}\bnot\b/i,
];
const SAME_COLLEGE_NOT = /\bdifferent\b|\bneed not\b|\bnot necessar|\bor different\b|\bany (college|institut)/i;
const WOMEN_ONLY = /\b(only|exclusively)\b[^.]{0,20}\b(women|female|girls?)\b|\ball[- ](women|female|girls?)\b|\b(women|female|girls?)[- ]only\b|\bwomen coders\b/i;

const sentences = text => String(text || '').split(/[.;\n]/);

export function sameCollege(text) {
  return sentences(text).some(s => !SAME_COLLEGE_NOT.test(s) && SAME_COLLEGE.some(re => re.test(s)));
}
export function womenOnly(text) {
  return sentences(text).some(s => WOMEN_ONLY.test(s));
}

// Facts for an Unstop record, from its private eligibility and body text.
export function unstopFacts(rec) {
  const filters = rec.eligible_filters || [];
  return {
    stated: Boolean(rec.eligibility) || filters.length > 0,
    same_college: sameCollege(rec.details_text),
    women_only: womenOnly(rec.details_text),
  };
}

// ---- verdict ----------------------------------------------------------------------

const STREAMS = {
  engineering: { list: 'engineering', codes: ['all', 'allCourses', 'btech', 'be'], filter: 'Engineering Students' },
  management: { list: 'bSchools', codes: [...BSCHOOL_OPEN, ...BSCHOOL_UG], filter: 'Management' },
  science: { list: 'arts', codes: ['all', 'allCourses', 'bs', 'bsc', 'artsOthers'], filter: 'Arts, Commerce, Sciences & Others' },
};
const STREAM_FILTERS = ['Engineering Students', 'Management', 'Medical', 'Law', 'Arts, Commerce, Sciences & Others'];
const STUDENT_FILTERS = ['Engineering Students', 'Postgraduate', 'Undergraduate', ...STREAM_FILTERS.slice(1)];

const entryCode = x => (typeof x === 'string' ? x : x?.course);
const entryYears = x => (x && typeof x === 'object' && Array.isArray(x.passoutYear) ? x.passoutYear.map(String) : ['all']);
const rawList = (el, key) => (Array.isArray(el?.[key]) ? el[key] : []);

// { course, year } for one member against Unstop course lists and years.
function memberAdmitted(member, el, filters) {
  const years = Array.isArray(el?.studentPassoutYearsSelected) ? el.studentPassoutYearsSelected.map(String) : [];
  const topYear = !years.length || years.includes('all') || years.includes(String(member.year));
  const populated = COURSE_LISTS.filter(k => courses(el, k).length);
  const othersAll = courses(el, 'others').some(c => c === 'all' || c === 'allCourses');
  if (populated.length && !othersAll) {
    const entries = member.streams.flatMap(s => (STREAMS[s] ? rawList(el, STREAMS[s].list).filter(x => STREAMS[s].codes.includes(entryCode(x))) : []));
    const course = entries.length > 0;
    const courseYear = !course || entries.some(x => { const y = entryYears(x); return y.includes('all') || y.includes(String(member.year)); });
    return { course, year: topYear && courseYear };
  }
  if (!populated.length && !othersAll && filters.length && !filters.includes('All') && filters.some(f => STREAM_FILTERS.includes(f))) {
    return { course: member.streams.some(s => STREAMS[s] && filters.includes(STREAMS[s].filter)), year: topYear };
  }
  return { course: true, year: topYear };
}

const names = ms => ms.map(m => m.name).join(' and ');
const onlyReason = (ms, by) => `only ${names(ms)} ${ms.length === 1 ? 'is' : 'are'} eligible by ${by}`;

// `rec` carries eligibility (Unstop, may be null), eligible_filters, team_min,
// fee and `facts`: { stated, same_college, women_only, school_only,
// not_students, abroad, invite_only }. `team` is data/hack-team.json.
export function hackVerdict(rec, team) {
  const el = rec.eligibility || null;
  const filters = rec.eligible_filters || [];
  const facts = rec.facts || {};
  const members = Array.isArray(team?.members) ? team.members : [];
  const out = reason => ({ level: 'out', reasons: [reason] });

  const sector = Array.isArray(el?.sector) ? el.sector : [];
  if (facts.school_only || (sector.length && !sector.includes('students') && sector.includes('school'))) return out('school students only');
  if (facts.not_students || (sector.length && !sector.includes('students'))) return out('not open to students');
  if (filters.length && !filters.includes('All')) {
    const student = filters.some(f => STUDENT_FILTERS.includes(f));
    if (!student && filters.includes('School Students')) return out('school students only');
    if (!student) return out('not open to students');
    if (filters.includes('Postgraduate') && !filters.includes('Undergraduate')) return out('postgraduate only');
  }

  const reasons = [];
  if (members.length) {
    const admitted = members.map(m => ({ m, ...memberAdmitted(m, el, filters) }));
    const byCourse = admitted.filter(a => a.course).map(a => a.m);
    const byYear = admitted.filter(a => a.year).map(a => a.m);
    const both = admitted.filter(a => a.course && a.year).map(a => a.m);
    if (!byCourse.length) {
      const populated = COURSE_LISTS.filter(k => courses(el, k).length);
      return out(`open to ${populated.length ? courseNames(el, populated) : filters.filter(f => STREAM_FILTERS.includes(f)).join(', ')} only`);
    }
    if (!byYear.length) {
      const numeric = (el?.studentPassoutYearsSelected || []).map(Number).filter(Number.isInteger);
      return out(numeric.length ? `graduating ${numeric.join(', ')} only` : 'no member graduates in a listed year');
    }
    if (!both.length) return out('no member meets both the course and the year rule');
    if (both.length < members.length) {
      const courseShort = byCourse.length < members.length;
      const yearShort = byYear.length < members.length;
      reasons.push(onlyReason(both, courseShort && yearShort ? 'course and year' : courseShort ? 'course' : 'year'));
    }
  }

  const size = members.length || 1;
  if (rec.team_min && rec.team_min > size) {
    if (!team?.can_grow) return out(`needs at least ${rec.team_min} members`);
    reasons.push(`needs ${rec.team_min} members, recruit`);
  }
  if (facts.same_college) reasons.push('form a same-college team');
  if (rec.fee) reasons.push('entry fee');
  if (!facts.stated) reasons.push('eligibility not stated');
  if (facts.abroad) reasons.push(`in-person abroad (${facts.abroad})`);
  if (facts.women_only) reasons.push('women only');
  if (facts.invite_only) reasons.push('invite only');
  return reasons.length ? { level: 'check', reasons } : { level: 'fits', reasons: [] };
}

// Curated rows (data/hack-curated.json) carry a verified, team-specific note
// in the fest row shape: indian_ug 'no' → out, 'unclear' → check, 'yes' → fits.
export function curatedHackVerdict(row) {
  if (row?.indian_ug === 'no') return { level: 'out', reasons: [row.indian_ug_note || 'not open to the team'] };
  if (row?.indian_ug === 'yes') return { level: 'fits', reasons: [] };
  return { level: 'check', reasons: [row?.indian_ug_note || 'eligibility not stated'] };
}
