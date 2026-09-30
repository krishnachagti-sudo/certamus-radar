// Eligibility rule by rule, derived from the stored verdict only (the fetch
// never publishes the raw eligibility). RULES lists fetch/classify.js's
// checks in the order it runs them; `match` recognises that rule's reason.
// fits -> every rule passes; check -> the stored reasons warn on their rules,
// the rest pass; out -> the reason fails its rule, earlier rules passed and
// later rules were never checked. Pure: no DOM, no fetch.

export const RULES = [
  { name: 'Team size', pass: 'minimum team size fits a team of four', match: r => /^needs at least \d+ members?$/.test(r) },
  { name: 'Open to students', pass: 'open to students', match: r => r === 'not open to students' },
  { name: 'Graduating year', pass: 'no graduating-year restriction that excludes 2029', match: r => /^graduating .+ only$/.test(r) },
  { name: 'Course list', pass: 'course list leaves room for BMS', match: (r, c) => /^open to .+ only$/.test(r) && !isFilterReason(r, c) },
  { name: 'Filters (UG/management)', pass: 'listed for undergraduates or management', match: (r, c) => r === 'postgraduate only' || isFilterReason(r, c) },
  { name: 'BBA/IPM wording', pass: 'no BBA/IPM-only course wording', match: r => r.startsWith('listed for BBA/IPM/B.Com') },
  { name: 'Restrictive wording in brief', pass: 'no "MBA only" or "students of <host> only" found', match: r => r.startsWith('details say ') },
  { name: 'Entry fee', pass: 'free to enter', match: r => r === 'entry fee' },
  { name: 'Eligibility stated', pass: 'eligibility is stated', match: r => r === 'eligibility not stated' },
  { name: 'Details fetched', pass: 'details were read', match: r => r === 'details not fetched' },
];

// classify writes "open to <filters joined by ', '> only" for the filter rule
// and "open to <course names> only" for the course rule; the stored filters
// tell them apart.
function isFilterReason(reason, c) {
  const f = Array.isArray(c.eligible_filters) ? c.eligible_filters : [];
  return f.length > 0 && reason === `open to ${f.join(', ')} only`;
}

// [{ name, state: 'ok'|'check'|'out'|'unchecked', detail }] for one rule
// table and one record's stored verdict.
function rowsFor(rules, c) {
  const level = c?.verdict?.level;
  const reasons = Array.isArray(c?.verdict?.reasons) ? c.verdict.reasons.map(String) : [];
  const ruleOf = r => rules.findIndex(rule => rule.match(r, c));

  if (level === 'fits') return rules.map(r => ({ name: r.name, state: 'ok', detail: r.pass }));

  if (level === 'check') {
    const rows = rules.map(r => ({ name: r.name, state: 'ok', detail: r.pass }));
    const extra = [];
    for (const reason of reasons) {
      const i = ruleOf(reason);
      if (i >= 0) rows[i] = { name: rules[i].name, state: 'check', detail: reason };
      else extra.push({ name: 'Other', state: 'check', detail: reason });
    }
    return [...rows, ...extra];
  }

  if (level === 'out') {
    const reason = reasons[0] ?? '';
    const at = ruleOf(reason);
    const rows = rules.map((r, i) => {
      if (at < 0 || i > at) return { name: r.name, state: 'unchecked', detail: 'not checked' };
      if (i < at) return { name: r.name, state: 'ok', detail: r.pass };
      return { name: r.name, state: 'out', detail: reason };
    });
    return at < 0 ? [...rows, { name: 'Other', state: 'out', detail: reason || 'ruled out' }] : rows;
  }

  return rules.map(r => ({ name: r.name, state: 'unchecked', detail: 'not checked' }));
}

// Case comps: null for curated and Opportunity Desk records, which show
// their own facts instead.
export function eligibilityRows(c) {
  if (c?.source) return null;
  return rowsFor(RULES, c);
}

// Hackathons: fetch/hack-classify.js's hackVerdict checks, in the order it
// runs them. Out reasons come first (students, level, course, year, both),
// then the check reasons in the order hackVerdict pushes them.
export const HACK_RULES = [
  { name: 'Open to students', pass: 'open to college students', match: r => r === 'not open to students' || r === 'school students only' },
  { name: 'Undergraduates', pass: 'open to undergraduates', match: r => r === 'postgraduate only' },
  { name: 'Course', pass: 'the listed courses admit every member', match: r => /^open to .+ only$/.test(r) || / eligible by course$/.test(r) },
  { name: 'Graduating year', pass: 'the listed years admit every member', match: r => /^graduating .+ only$/.test(r) || r === 'no member graduates in a listed year' || / eligible by year$/.test(r) },
  { name: 'Course and year together', pass: 'every member meets both the course and the year rule', match: r => r === 'no member meets both the course and the year rule' || / eligible by course and year$/.test(r) },
  { name: 'Team size', pass: 'minimum team size fits the team', match: r => /^needs (at least )?\d+ members?\b/.test(r) },
  { name: 'Same-college team', pass: 'mixed-college teams allowed', match: r => r === 'form a same-college team' },
  { name: 'Entry fee', pass: 'free to enter', match: r => r === 'entry fee' },
  { name: 'Eligibility stated', pass: 'eligibility is stated', match: r => r === 'eligibility not stated' },
  { name: 'Location', pass: 'online or in India', match: r => r.startsWith('in-person abroad') },
  { name: 'Women only', pass: 'open to every member', match: r => r === 'women only' },
  { name: 'Invite only', pass: 'open entry', match: r => r === 'invite only' },
];

// Null for curated hackathons (hk-), which show the curated facts instead.
export function hackEligibilityRows(c) {
  if (!c || c.source === 'curated') return null;
  return rowsFor(HACK_RULES, c);
}
