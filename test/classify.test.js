import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tier, verdict } from '../fetch/classify.js';

const dataPath = name => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const realLists = {
  bschools: JSON.parse(readFileSync(dataPath('bschools.json'), 'utf8')),
  corporates: JSON.parse(readFileSync(dataPath('corporates.json'), 'utf8')),
  national: JSON.parse(readFileSync(dataPath('national.json'), 'utf8')),
};

const team = { size: 4, passout_years: [2029] };
const lists = {
  bschools: [{ name: 'XLRI', host: 'XLRI|Xavier School of Management' }],
  corporates: [{ name: 'HUL LIME', host: 'Hindustan Unilever', title: '\\bLIME\\b' }],
};
const open = { sector: ['students'], others: ['all'], studentPassoutYearsSelected: ['all'] };
const rec = over => ({
  title: 'A case', host: 'Somewhere', team_min: 1, team_max: 4, fee: false,
  eligible_filters: ['All'], eligibility: open,
  details_text: 'A case competition.', details_fetched: true, ...over,
});
const v = over => verdict(rec(over), team);

test('tiers', () => {
  assert.equal(tier(rec({ host: 'Indian Institute of Technology (IIT), Delhi' }), lists), 'iit');
  assert.equal(tier(rec({ host: 'Indian Institute of Management (IIM), Raipur' }), lists), 'iim');
  assert.equal(tier(rec({ host: 'IIIT Hyderabad' }), lists), 'other', 'no national list given: other');
  assert.equal(tier(rec({ host: 'Xavier School of Management (XLRI)' }), lists), 'bschool');
  assert.equal(tier(rec({ host: 'Hindustan Unilever Limited' }), lists), 'corporate');
  assert.equal(tier(rec({ host: 'Unilever Careers', title: 'LIME Season 17' }), lists), 'corporate');
  assert.equal(tier(rec({ host: 'Some College' }), lists), 'other');
});

// One case per rule row, in rule order.
test('out: minimum team larger than ours', () => {
  assert.deepEqual(v({ team_min: 5 }), { level: 'out', reasons: ['needs at least 5 members'] });
});
test('out: not open to students', () => {
  assert.equal(v({ eligibility: { ...open, sector: ['corporates'] } }).level, 'out');
});
test('out: graduating years exclude ours', () => {
  assert.deepEqual(v({ eligibility: { ...open, studentPassoutYearsSelected: [2026, 2027] } }),
    { level: 'out', reasons: ['graduating 2026, 2027 only'] });
  assert.equal(v({ eligibility: { ...open, studentPassoutYearsSelected: [2028, 2029] } }).level, 'fits');
});
test('out: MBA/PGDM course list only', () => {
  const el = { sector: ['students'], others: [], bSchools: [{ course: 'mba1' }, { course: 'mba2' }, { course: 'pgdm' }] };
  assert.deepEqual(v({ eligibility: el }), { level: 'out', reasons: ['open to MBA/PGDM only'] });
});
test('out: postgraduate only filters', () => {
  assert.deepEqual(v({ eligible_filters: ['Management', 'Postgraduate'] }), { level: 'out', reasons: ['postgraduate only'] });
});
test('out: filters name neither UG nor management', () => {
  assert.equal(v({ eligible_filters: ['Engineering Students'] }).level, 'out');
});
test('check: listed for BBA only', () => {
  const r = v({ eligibility: { sector: ['students'], others: [], bSchools: [{ course: 'bba' }] } });
  assert.equal(r.level, 'check');
  assert.match(r.reasons[0], /BBA/);
});
test('check: details say MBA only', () => {
  const r = v({ details_text: 'This competition is open to MBA students only.' });
  assert.equal(r.level, 'check');
  assert.match(r.reasons[0], /MBA students only/);
});
test('check: details restrict to the host', () => {
  assert.equal(v({ details_text: 'Open only for students of IIM Raipur.' }).level, 'check');
});
test('check: entry fee', () => {
  assert.deepEqual(v({ fee: true }), { level: 'check', reasons: ['entry fee'] });
});
test('check: eligibility missing', () => {
  assert.deepEqual(v({ eligibility: null }), { level: 'check', reasons: ['eligibility not stated'] });
});
test('check: details not fetched', () => {
  assert.deepEqual(v({ details_fetched: false, details_text: '' }), { level: 'check', reasons: ['details not fetched'] });
});
test('fits: open to everyone', () => {
  assert.deepEqual(v({}), { level: 'fits', reasons: [] });
});

// --- Live-review fixes ---

test('fits: Arts/Commerce/Sciences filter label is acceptable', () => {
  assert.equal(v({ eligible_filters: ['Arts, Commerce, Sciences & Others'] }).level, 'fits');
});

test('not out: others allCourses overrides an MBA-only bSchools list', () => {
  const el = { sector: ['students'], others: ['allCourses'], bSchools: [{ course: 'mba1' }, { course: 'mba2' }] };
  const r = v({ eligible_filters: ['Undergraduate', 'Postgraduate', 'Management'], eligibility: el });
  assert.notEqual(r.level, 'out');
});

test('check: only MBA students can participate', () => {
  const r = v({ details_text: 'Only MBA students can participate.' });
  assert.equal(r.level, 'check');
});
test('check: open only to MBA/PGDM students', () => {
  const r = v({ details_text: 'Open only to MBA/PGDM students.' });
  assert.equal(r.level, 'check');
});
test('check: exclusively for postgraduate students', () => {
  const r = v({ details_text: 'Exclusively for postgraduate students.' });
  assert.equal(r.level, 'check');
});
test('check: eligibility pursuing MBA or PGDM', () => {
  const r = v({ details_text: 'Eligibility: students pursuing MBA or PGDM.' });
  assert.equal(r.level, 'check');
});
test('fits: undergraduate and postgraduate students only is not postgraduate-only', () => {
  const r = v({ details_text: 'Open to undergraduate and postgraduate students only.' });
  assert.equal(r.level, 'fits');
});
test('fits: MBA or BMS teams, semicolon separates the only-one-entry clause', () => {
  const r = v({ details_text: 'Teams may include MBA or BMS students; only one entry per team.' });
  assert.equal(r.level, 'fits');
});

test('tier: TISS is a B-school / top college, not the Tata corporate', () => {
  assert.equal(tier(rec({ host: 'Tata Institute of Social Sciences (TISS)' }), realLists), 'bschool');
});
test('tier: Mahindra University is not the Mahindra corporate', () => {
  assert.equal(tier(rec({ host: 'Mahindra University' }), realLists), 'other');
});
test('tier: a college host is never matched by title alone', () => {
  assert.equal(tier(rec({ host: 'Amity University, Noida', title: 'Marketing War Room 2026' }), realLists), 'other');
  assert.equal(tier(rec({ host: 'NIT Trichy', title: 'Marketing War Room 2026' }), realLists), 'national');
});
test('tier: FMS BHU is not FMS Delhi', () => {
  assert.equal(tier(rec({ host: 'Faculty of Management Studies (FMS), BHU' }), realLists), 'other');
});
test('tier: SP Jain School of Global Management is not SPJIMR', () => {
  assert.equal(tier(rec({ host: 'SP Jain School of Global Management' }), realLists), 'other');
});
test('tier: IIM and Commerce is not an IIM', () => {
  assert.equal(tier(rec({ host: 'Indian Institute of Management and Commerce (IIMC), Hyderabad' }), realLists), 'other');
});
test('tier: Tata Steel is the corporate', () => {
  assert.equal(tier(rec({ host: 'Tata Steel' }), realLists), 'corporate');
});

test('tier: Mahindra Rise host is not miscategorised as a college by a NIT substring', () => {
  assert.equal(tier(rec({ host: 'Mahindra Rise Community', title: 'The War Room 2026' }), realLists), 'corporate');
});
test('tier: IIM and Commerce with an ampersand is not an IIM', () => {
  assert.equal(tier(rec({ host: 'Indian Institute of Management & Commerce' }), realLists), 'other');
});
test('fits: MBA/PGDM/PGP mentioned in the same sentence as undergraduate', () => {
  const r = v({ details_text: 'Open to students currently enrolled in full-time MBA, PGDM, PGP and undergraduate programs.' });
  assert.equal(r.level, 'fits');
});
test('fits: MBA and BMS welcome in the same sentence', () => {
  const r = v({ details_text: 'Only one team per college, MBA and BMS welcome.' });
  assert.equal(r.level, 'fits');
});
test('check: MBA only with no mention of undergraduates still flags', () => {
  const r = v({ details_text: 'Open to MBA students only.' });
  assert.equal(r.level, 'check');
});

test('out reason: readable course names, capped list, category label when "all" is present', () => {
  const el = { sector: ['students'], others: [], arts: ['all'], bSchools: [{ course: 'mba1' }] };
  const r = v({ eligibility: el });
  assert.equal(r.level, 'out');
  assert.match(r.reasons[0], /^open to (MBA\/Arts courses|Arts courses\/MBA) only$/);
});

// ---- national tier -----------------------------------------------------------
const T = host => tier(rec({ host }), realLists);

test('tier national: NITs, IIITs and the other national institutes', () => {
  for (const host of [
    'National Institute of Technology (NIT), Calicut', 'NIT Warangal', 'Entrepreneurship Club, NIT Warangal',
    'Motilal Nehru National Institute of Technology', 'Maulana Azad National Institute of Technology (MANIT), Bhopal',
    'Indian Institute of Information Technology (IIIT) Kottayam', 'International Institute of Information Technology (IIIT), Bangalore',
    'Indraprastha Institute of Information Technology (IIIT), Delhi', 'IIIT Hyderabad', 'Indraprastha IIIT Delhi',
    'Indian Institute of Science (IISc), Bangalore', 'IISc Bangalore', 'Indian Institute of Science Education and Research (IISER), Pune',
    'IISER Kolkata', 'Birla Institute of Technology & Science (BITS) Pilani, Hyderabad Campus',
    'Birla Institute of Technology and Science, Pilani', 'BITS Goa', 'Indian Statistical Institute, Kolkata', 'ISI Delhi',
    'Delhi Technological University (DTU), New Delhi', 'USME, Delhi Technological University, Vivek Vihar', 'DTU',
    'Netaji Subhas University of Technology (NSUT), Delhi', 'NSUT East Campus',
    'Indian Institute of Engineering Science and Technology (IIEST), Shibpur', 'IIEST Shibpur',
    'Jadavpur University, Kolkata', 'NITIE Mumbai', 'National Institute of Industrial Engineering',
  ]) assert.equal(T(host), 'national', host);
});

test('tier national: checked after IIT and IIM', () => {
  assert.equal(T('Indian Institute of Technology (IIT), Bombay'), 'iit');
  assert.equal(T('IIM Mumbai (formerly NITIE)'), 'iim');
  assert.equal(T('Indian Institute of Management Mumbai (NITIE)'), 'iim');
});

test('tier national guards: IIIT is never IIT, NIT only as a whole word', () => {
  assert.equal(T('IIIT Hyderabad'), 'national');
  assert.notEqual(T('Indian Institute of Information Technology, Design and Manufacturing'), 'iit');
  for (const host of ['Unity Club', 'Community College of Unity', 'Unitech Labs', 'Nitte University', 'Knitwear Society',
    'Jaypee Institute of Information Technology (JIIT), Noida', 'AISSMS Institute of Information Technology, Pune',
    'Birla Institute of Technology Mesra, Noida Campus', 'National Institute of Fashion Technology (NIFT), Delhi',
    'Vishwakarma Institute Of Information Technology (VIIT), Pune', 'Mahindra University', 'Bits and Bytes Club']) {
    assert.equal(T(host), 'other', host);
  }
});

// ---- extended B-school / top college list -------------------------------------

test('tier bschool: the original seven are kept', () => {
  for (const host of ['Indian School of Business (ISB)', 'Xavier School of Management (XLRI)', 'FMS Delhi', 'SPJIMR',
    'Management Development Institute (MDI), Gurgaon', 'Indian Institute of Foreign Trade (IIFT), New Delhi', 'JBIMS Mumbai']) {
    assert.equal(T(host), 'bschool', host);
  }
});

test('tier bschool: added B-schools and top commerce / liberal-arts colleges', () => {
  for (const host of [
    'Narsee Monjee Institute of Management Studies (NMIMS), Indore', 'School of Business Management, NMIMS Mumbai',
    'Symbiosis Institute of Business Management (SIBM), Pune', 'SIIB Pune',
    'Symbiosis Centre for Management and Human Resource Development (SCMHRD), Pune',
    'Symbiosis Institute of Management Studies (SIMS), Pune', 'Symbiosis Institute of International Business',
    'Institute of Management Technology (IMT), Ghaziabad', 'IMT Nagpur',
    'Xavier Institute of Management, Bhubaneswar (XIMB)', 'XIM University', 'TAPMI Manipal', 'T. A. Pai Management Institute',
    'Great Lakes Institute of Management, Chennai', 'Institute of Rural Management Anand (IRMA)', 'MICA Ahmedabad',
    'Tata Institute of Social Sciences (TISS)', 'IBS Business School Ahmedabad', 'ICFAI Business School (IBS), Hyderabad',
    'K J Somaiya Institute of Management, Mumbai', 'SIMSR Mumbai', 'Welingkar Institute of Management',
    'Shri Ram College of Commerce, University of Delhi', 'SRCC', "St. Stephen's College, Delhi University",
    'Lady Shri Ram College for Women (LSR) University of Delhi (DU)', 'Hindu College, University of Delhi (DU), New Delhi',
    'Hansraj College,University of Delhi', 'Kirori Mal College (KMC), University of Delhi, Delhi',
    'CHRIST (Deemed to be University) Delhi NCR', 'Christ University, Bangalore',
    "St. Xavier's College (Autonomous), Mumbai", "St. Xavier's College, Kolkata", "St Xavier's University, Kolkata",
  ]) assert.equal(T(host), 'bschool', host);
});

test('tier bschool guards: technology arms and namesakes stay out', () => {
  for (const host of ['Symbiosis Center for Information Technology (SCIT), Pune', 'Symbiosis Institute of Technology (SIT), Pune',
    'K J Somaiya College of Engineering', "St. Xavier's College, Ranchi", 'Christ College, Rajkot', 'Sindhu College']) {
    assert.equal(T(host), 'other', host);
  }
});
