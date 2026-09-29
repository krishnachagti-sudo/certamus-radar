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

// [{ name, state: 'ok'|'check'|'out'|'unchecked', detail }], or null for
// curated and Opportunity Desk records, which show their own facts instead.
export function eligibilityRows(c) {
  if (c?.source) return null;
  const level = c?.verdict?.level;
  const reasons = Array.isArray(c?.verdict?.reasons) ? c.verdict.reasons.map(String) : [];
  const ruleOf = r => RULES.findIndex(rule => rule.match(r, c));

  if (level === 'fits') return RULES.map(r => ({ name: r.name, state: 'ok', detail: r.pass }));

  if (level === 'check') {
    const rows = RULES.map(r => ({ name: r.name, state: 'ok', detail: r.pass }));
    const extra = [];
    for (const reason of reasons) {
      const i = ruleOf(reason);
      if (i >= 0) rows[i] = { name: RULES[i].name, state: 'check', detail: reason };
      else extra.push({ name: 'Other', state: 'check', detail: reason });
    }
    return [...rows, ...extra];
  }

  if (level === 'out') {
    const reason = reasons[0] ?? '';
    const at = ruleOf(reason);
    const rows = RULES.map((r, i) => {
      if (at < 0 || i > at) return { name: r.name, state: 'unchecked', detail: 'not checked' };
      if (i < at) return { name: r.name, state: 'ok', detail: r.pass };
      return { name: r.name, state: 'out', detail: reason };
    });
    return at < 0 ? [...rows, { name: 'Other', state: 'out', detail: reason || 'ruled out' }] : rows;
  }

  return RULES.map(r => ({ name: r.name, state: 'unchecked', detail: 'not checked' }));
}
