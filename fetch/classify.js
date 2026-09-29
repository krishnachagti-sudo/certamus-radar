// Tier and eligibility verdict for one competition record. Pure: lists and
// team are arguments, so nothing here reads data/.

const IIT = /indian institute of technology|\bIIT\b/i;
const IIM = /indian institute of management|\bIIM\b/i;

export function tier(rec, lists) {
  const host = rec.host || '';
  const title = rec.title || '';
  if (IIT.test(host)) return 'iit';
  if (IIM.test(host)) return 'iim';
  if (lists.bschools.some(b => new RegExp(b.host, 'i').test(host))) return 'bschool';
  if (lists.corporates.some(c => new RegExp(c.host, 'i').test(host) || (c.title && new RegExp(c.title, 'i').test(title)))) {
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
// Hosts often tick "Undergraduate" and then say otherwise in the body.
const DETAIL_FLAGS = [
  /\b(MBA|PGDM)\b[^.]{0,40}\bonly\b/i,
  /\bpost[- ]?graduates?\b[^.]{0,20}\bonly\b/i,
  /\bPG students only\b/i,
  /\b(only|exclusively)\b[^.]{0,20}\bstudents of\b[^.]{0,60}/i,
  /\bstudents of [^.]{1,60}\bonly\b/i,
];

function courses(el, key) {
  const list = Array.isArray(el?.[key]) ? el[key] : [];
  return list.map(x => (typeof x === 'string' ? x : x?.course)).filter(Boolean);
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
  const othersAll = courses(el, 'others').includes('all');
  const bs = courses(el, 'bSchools');
  if (populated.length && !othersAll && !bs.some(c => BSCHOOL_OPEN.includes(c) || BSCHOOL_UG.includes(c))) {
    const names = [...new Set(populated.flatMap(k => courses(el, k)).map(c => COURSE_LABEL[c] || c))];
    return out(`open to ${names.join('/')} only`);
  }

  const has = f => filters.includes(f);
  if (filters.length && !has('All')) {
    if (has('Postgraduate') && !has('Undergraduate')) return out('postgraduate only');
    if (!has('Undergraduate') && !has('Management')) return out(`open to ${filters.join(', ')} only`);
  }

  const reasons = [];
  if (populated.length && !othersAll && !bs.some(c => BSCHOOL_OPEN.includes(c))) {
    reasons.push('listed for BBA/IPM/B.Com; BMS usually counts, confirm');
  }
  const flag = DETAIL_FLAGS.map(re => (rec.details_text || '').match(re)).find(Boolean);
  if (flag) reasons.push(`details say "${flag[0].trim()}"`);
  if (rec.fee) reasons.push('entry fee');
  if (!el) reasons.push('eligibility not stated');
  if (!rec.details_fetched && !rec.details_text) reasons.push('details not fetched');
  return reasons.length ? { level: 'check', reasons } : { level: 'fits', reasons: [] };
}
