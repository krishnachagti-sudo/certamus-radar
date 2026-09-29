// Tier and eligibility verdict for one competition record. Pure: lists and
// team are arguments, so nothing here reads data/.

const IIT = /indian institute of technology|\bIIT\b/i;
const IIM = /indian institute of management(?! (and|&) commerce)|\bIIM\b/i;
const IS_COLLEGE = /universit|college|institute|school|\bIIT\b|\bIIM\b|\bNIT\b|\bIIIT\b|\bBITS\b/i;

const hostIn = (list, host) => (Array.isArray(list) ? list : []).some(b => new RegExp(b.host, 'i').test(host));

// Order: iit, iim, national (data/national.json), bschool (data/bschools.json),
// corporate (data/corporates.json), other. "IIIT" never matches the IIT rule:
// \bIIT\b needs a word boundary before the I.
export function tier(rec, lists) {
  const host = rec.host || '';
  const title = rec.title || '';
  if (IIT.test(host)) return 'iit';
  if (IIM.test(host)) return 'iim';
  if (hostIn(lists.national, host)) return 'national';
  if (hostIn(lists.bschools, host)) return 'bschool';
  const hostIsCollege = IS_COLLEGE.test(host);
  if ((lists.corporates || []).some(c => {
    if (new RegExp(c.host, 'i').test(host)) return true;
    if (c.title && new RegExp(c.title, 'i').test(title) && !hostIsCollege) return true;
    return false;
  })) {
    return 'corporate';
  }
  return 'other';
}

const COURSE_LISTS = ['bSchools', 'engineering', 'arts', 'medicine', 'law'];
const BSCHOOL_OPEN = ['all', 'allCourses', 'bSchoolOthers'];
const BSCHOOL_UG = ['bba', 'ipm', 'bcom'];
const COURSE_LABEL = {
  mba1: 'MBA', mba2: 'MBA', pgdm: 'PGDM', execMba: 'Executive MBA', phdManagement: 'PhD', mcom: 'M.Com',
  btech: 'B.Tech', mtech: 'M.Tech', mca: 'MCA', mca1: 'MCA', bba: 'BBA', ipm: 'IPM', bcom: 'B.Com',
};
const CATEGORY_LABEL = {
  bSchools: 'MBA', engineering: 'Engineering courses', arts: 'Arts courses', medicine: 'Medicine courses', law: 'Law courses',
};
// Filter labels that leave room for a BMS (commerce) undergraduate, alongside
// the explicit Undergraduate/Management labels.
const OPEN_FILTER_LABELS = ['Undergraduate', 'Management', 'Arts, Commerce, Sciences & Others'];
// Hosts often tick "Undergraduate" and then say otherwise in the body.
const DETAIL_FLAGS = [
  /\b(MBA|PGDM)\b[^.;]{0,40}\bonly\b/i,
  /(?<!undergraduate and )\bpost[- ]?graduates?\b[^.;]{0,20}\bonly\b/i,
  /\bPG students only\b/i,
  /\b(only|exclusively)\b[^.;]{0,20}\bstudents of\b[^.;]{0,60}/i,
  /\bstudents of [^.;]{1,60}\bonly\b/i,
  /\b(only|exclusively)\b[^.;]{0,30}\b(MBA|PGDM|PGP|post[- ]?graduates?|PG)\b/i,
  /\b(pursuing|enrolled in)\b[^.;]{0,20}\b(MBA|PGDM|PGP)\b/i,
];

function courses(el, key) {
  const list = Array.isArray(el?.[key]) ? el[key] : [];
  return list.map(x => (typeof x === 'string' ? x : x?.course)).filter(Boolean);
}

// A sentence that also names an undergraduate route (BMS's own route, or the
// generic "undergraduate"/BBA one) is not a restriction against BMS, even if
// it happens to mention MBA/PGDM elsewhere in the same breath.
const UG_MENTION = /\b(undergraduate|UG|BMS|BBA)\b/i;

function detailFlag(detailsText) {
  const sentences = (detailsText || '').split(/[.;\n]/);
  for (const sentence of sentences) {
    if (UG_MENTION.test(sentence)) continue;
    for (const re of DETAIL_FLAGS) {
      const m = sentence.match(re);
      if (m) return m[0].trim();
    }
  }
  return null;
}

// Names a populated course list for the "open to X only" reason: a list
// containing 'all'/'allCourses' is named by its category, otherwise by the
// specific course codes it lists. Capped at 6 names, then "and N more".
function courseNames(el, populated) {
  const names = [];
  for (const key of populated) {
    const list = courses(el, key);
    if (list.some(c => c === 'all' || c === 'allCourses')) {
      names.push(CATEGORY_LABEL[key] || key);
    } else {
      for (const c of list) names.push(COURSE_LABEL[c] || c);
    }
  }
  const unique = [...new Set(names)];
  if (unique.length <= 6) return unique.join('/');
  return `${unique.slice(0, 6).join('/')} and ${unique.length - 6} more`;
}

export function verdict(rec, team) {
  const el = rec.eligibility;
  const filters = rec.eligible_filters || [];
  const out = reason => ({ level: 'out', reasons: [reason] });

  if (rec.team_min && rec.team_min > team.size) return out(`needs at least ${rec.team_min} members`);
  if (el && Array.isArray(el.sector) && el.sector.length && !el.sector.includes('students')) return out('not open to students');

  const years = Array.isArray(el?.studentPassoutYearsSelected) ? el.studentPassoutYearsSelected : [];
  const numeric = years.map(Number).filter(Number.isInteger);
  if (!years.includes('all') && numeric.length && !numeric.some(y => team.passout_years.includes(y))) {
    return out(`graduating ${numeric.join(', ')} only`);
  }

  const populated = COURSE_LISTS.filter(k => courses(el, k).length);
  const othersList = courses(el, 'others');
  const othersAll = othersList.includes('all') || othersList.includes('allCourses');
  const bs = courses(el, 'bSchools');
  if (populated.length && !othersAll && !bs.some(c => BSCHOOL_OPEN.includes(c) || BSCHOOL_UG.includes(c))) {
    return out(`open to ${courseNames(el, populated)} only`);
  }

  const has = f => filters.includes(f);
  if (filters.length && !has('All')) {
    if (has('Postgraduate') && !has('Undergraduate')) return out('postgraduate only');
    if (!OPEN_FILTER_LABELS.some(has)) return out(`open to ${filters.join(', ')} only`);
  }

  const reasons = [];
  if (populated.length && !othersAll && !bs.some(c => BSCHOOL_OPEN.includes(c))) {
    reasons.push('listed for BBA/IPM/B.Com; BMS usually counts, confirm');
  }
  const flag = detailFlag(rec.details_text);
  if (flag) reasons.push(`details say "${flag}"`);
  if (rec.fee) reasons.push('entry fee');
  if (!el) reasons.push('eligibility not stated');
  if (!rec.details_fetched && !rec.details_text) reasons.push('details not fetched');
  return reasons.length ? { level: 'check', reasons } : { level: 'fits', reasons: [] };
}
