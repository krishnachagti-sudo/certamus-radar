import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hackKind, hackTier, hackVerdict, unstopFacts, curatedHackVerdict } from '../fetch/hack-classify.js';

const team = {
  members: [
    { name: 'Krishna', level: 'ug', streams: ['management', 'science'], year: 2029 },
    { name: 'Akshit', level: 'ug', streams: ['engineering'], year: 2028 },
  ],
  can_grow: true,
};
const el = over => ({ sector: ['students'], engineering: [], bSchools: [], arts: [], medicine: [], law: [], others: ['all'], studentPassoutYearsSelected: ['all'], ...over });
// A record as hack-run hands it to hackVerdict: Unstop fields plus derived facts.
const rec = (over = {}) => ({ eligibility: el(), eligible_filters: ['All'], team_min: 1, team_max: 4, fee: false, facts: { stated: true }, ...over });
const v = (over, t = team) => hackVerdict(rec(over), t);

// ---- kinds --------------------------------------------------------------------

test('kind build: hackathon, buildathon, make-a-thon, -a-thon and hack titles', () => {
  for (const title of ['Cortex Hackathon', 'Mozilla Human Scale AI Buildathon', 'Make-A-Thon', 'Sustain-A-Thon 2.0', 'HackCOSMIC', 'Hack On Hills 8.0', 'NASA Space Apps Challenge 2026', 'Game Jam - TantraFiesta']) {
    assert.equal(hackKind({ title, source: 'unstop' }), 'build', title);
  }
});

test('kind ideathon: ideathon, idea, pitch, B-plan, startup and innovation-challenge titles', () => {
  for (const title of ['Junior Ideathon', 'IDEAForge 2026 | Online Ideathon', 'Idea Competition 2026', 'Business Plan Competition – From Idea to Market', 'Startupathon', 'Ignite Series – Open Innovation Challenge', 'Growth Hack Challenge']) {
    assert.equal(hackKind({ title, source: 'unstop' }), 'ideathon', title);
  }
});

test('kind other: coding contests, CTFs, data competitions, quizzes, robotics, esports and passes', () => {
  for (const title of ['Winter Coding Contest 6.0', 'Competitive Programming Hackathon', 'ICC CodeClash 2026', 'CP Contest', 'National Young Programmers Olympiad',
    'Cipher Chase — Capture the Flag', 'InIt CTF', 'Bug Bounty', 'Datathon 26–27', 'Sheridan Datathon 2026', 'Kaggle Days Challenge', 'Tech Quiz',
    'Robowars 2026', 'HackRobo 2.0', 'Line Follower (Autonomous Bot Time Trial)', 'Drone Race', 'UAV Competition', 'Pokerbots', 'Conv_Cup \'26: FIFA of Bots',
    'Valorant Tournament – Battle Zone', 'Poster Exhibition', 'Math-O-Stellar', 'Gold Pass']) {
    assert.equal(hackKind({ title, source: 'unstop' }), 'other', title);
  }
});

test('kind: a silent Unstop title reads the body (hackathon → build, ideathon → ideathon, else other)', () => {
  assert.equal(hackKind({ title: 'Hypnexis 2026', body: 'A 24-hour hackathon for builders.', source: 'unstop' }), 'build');
  assert.equal(hackKind({ title: 'Zinnovatio 4.0', body: 'An online ideathon round then a pitch.', source: 'unstop' }), 'ideathon');
  assert.equal(hackKind({ title: 'CryptX', body: 'A capture the flag hackathon.', source: 'unstop' }), 'other');
  assert.equal(hackKind({ title: 'Respawn', body: 'Register now.', source: 'unstop' }), 'other');
});

test('kind: a silent title on a hackathon platform (Devfolio, MLH, Devpost) is build', () => {
  for (const source of ['devfolio', 'mlh', 'devpost']) assert.equal(hackKind({ title: 'Codeutsava X.0', source }), 'build');
  assert.equal(hackKind({ title: 'TAMU Datathon', source: 'mlh' }), 'other');
});

// ---- tiers --------------------------------------------------------------------

const lists = {
  national: [{ name: 'NIT', host: '\\bNITs?\\b|National Institute of Technology' }],
  bschools: [{ name: 'SPJIMR', host: 'SPJIMR' }],
  corporates: [{ name: 'Flipkart', host: '\\bFlipkart\\b' }],
};

test('tier: institute tiers reuse the case-comp rules', () => {
  assert.equal(hackTier({ host: 'Indian Institute of Technology (IIT), Bombay' }, lists), 'iit');
  assert.equal(hackTier({ host: 'Indian Institute of Management (IIM), Raipur' }, lists), 'iim');
  assert.equal(hackTier({ host: 'NIT Raipur' }, lists), 'national');
  assert.equal(hackTier({ host: 'SPJIMR Mumbai' }, lists), 'bschool');
  assert.equal(hackTier({ host: 'International Institute of Information Technology (IIIT), Bangalore' }, lists), 'other');
});

test('tier corporate: a company host from the hackathon corporates list', () => {
  assert.equal(hackTier({ host: 'Flipkart' }, lists), 'corporate');
  assert.equal(hackTier({ host: 'WeCodeCoders' }, lists), 'other');
});

test('tier global: MLH and Devpost always, Devfolio when the country is not India', () => {
  assert.equal(hackTier({ host: 'NIT Raipur', source: 'mlh' }, lists), 'global');
  assert.equal(hackTier({ host: 'Amazon', source: 'devpost' }, lists), 'global');
  assert.equal(hackTier({ host: 'TUM', source: 'devfolio', country: 'Germany' }, lists), 'global');
  assert.equal(hackTier({ host: 'NIT Raipur', source: 'devfolio', country: 'India' }, lists), 'national');
  assert.equal(hackTier({ host: '', source: 'devfolio', country: null }, lists), 'other');
});

// ---- verdict: out ----------------------------------------------------------------

test('out: not open to students (sector)', () => {
  assert.deepEqual(v({ eligibility: el({ sector: ['corporates', 'fresher'] }) }), { level: 'out', reasons: ['not open to students'] });
});

test('out: school students only (sector or filters)', () => {
  assert.equal(v({ eligibility: el({ sector: ['school'] }) }).reasons[0], 'school students only');
  assert.equal(v({ eligibility: null, eligible_filters: ['School Students'] }).reasons[0], 'school students only');
  assert.equal(v({ eligibility: null, eligible_filters: [], facts: { stated: false, school_only: true } }).level, 'out');
});

test('out: postgraduate only', () => {
  assert.deepEqual(v({ eligibility: null, eligible_filters: ['Postgraduate', 'Management'] }), { level: 'out', reasons: ['postgraduate only'] });
});

test('out: listed years exclude every member', () => {
  assert.deepEqual(v({ eligibility: el({ studentPassoutYearsSelected: [2026, 2027] }) }), { level: 'out', reasons: ['graduating 2026, 2027 only'] });
});

test('out: listed courses exclude every member', () => {
  const r = v({ eligibility: el({ others: [], medicine: ['mbbs'], law: ['llb'] }) });
  assert.equal(r.level, 'out');
  assert.match(r.reasons[0], /^open to .*only$/);
});

test('out: stream filters exclude every member when no course lists are given', () => {
  assert.equal(v({ eligibility: null, eligible_filters: ['Medical', 'Law', 'Undergraduate'] }).level, 'out');
});

test('out: no member meets both the course and the year rule', () => {
  // Engineering only (Akshit), but 2029 only (Krishna).
  const r = v({ eligibility: el({ others: [], engineering: ['allCourses'], studentPassoutYearsSelected: [2029] }) });
  assert.deepEqual(r, { level: 'out', reasons: ['no member meets both the course and the year rule'] });
});

test('out: team_min above the team with can_grow false', () => {
  assert.deepEqual(v({ team_min: 3 }, { ...team, can_grow: false }), { level: 'out', reasons: ['needs at least 3 members'] });
});

// ---- verdict: check --------------------------------------------------------------

test('check: years admit only some members', () => {
  assert.deepEqual(v({ eligibility: el({ studentPassoutYearsSelected: [2027, 2028] }) }), { level: 'check', reasons: ['only Akshit is eligible by year'] });
});

test('check: a course entry\'s own passout years count as the year rule', () => {
  const listing = years => el({ others: [], engineering: [{ course: 'btech', passoutYear: years }], arts: ['bs'] });
  assert.deepEqual(v({ eligibility: listing(['2027']) }), { level: 'check', reasons: ['only Krishna is eligible by year'] });
  assert.deepEqual(v({ eligibility: listing(['2027', '2028']) }), { level: 'fits', reasons: [] });
});

test('check: courses admit only some members (engineering-only listing)', () => {
  assert.deepEqual(v({ eligibility: el({ others: [], engineering: [{ course: 'btech', passoutYear: ['all'] }] }) }), { level: 'check', reasons: ['only Akshit is eligible by course'] });
  assert.deepEqual(v({ eligibility: null, eligible_filters: ['Engineering Students', 'Undergraduate'] }), { level: 'check', reasons: ['only Akshit is eligible by course'] });
});

test('check: a science (BS/B.Sc) or management (BBA/BMS) listing admits Krishna only', () => {
  assert.deepEqual(v({ eligibility: el({ others: [], arts: ['bs', 'bsc'] }) }), { level: 'check', reasons: ['only Krishna is eligible by course'] });
  assert.deepEqual(v({ eligibility: el({ others: [], bSchools: ['bba'] }) }), { level: 'check', reasons: ['only Krishna is eligible by course'] });
});

test('check: same-college wording → form a same-college team', () => {
  assert.deepEqual(v({ facts: { stated: true, same_college: true } }), { level: 'check', reasons: ['form a same-college team'] });
});

test('check: team_min above the team → recruit', () => {
  assert.deepEqual(v({ team_min: 4 }), { level: 'check', reasons: ['needs 4 members, recruit'] });
});

test('check: entry fee', () => {
  assert.deepEqual(v({ fee: true }), { level: 'check', reasons: ['entry fee'] });
});

test('check: eligibility not stated', () => {
  assert.deepEqual(v({ eligibility: null, eligible_filters: [], facts: { stated: false } }), { level: 'check', reasons: ['eligibility not stated'] });
});

test('check: in-person abroad', () => {
  assert.deepEqual(v({ facts: { stated: true, abroad: 'US' } }), { level: 'check', reasons: ['in-person abroad (US)'] });
});

test('check: women only', () => {
  assert.deepEqual(v({ facts: { stated: true, women_only: true } }), { level: 'check', reasons: ['women only'] });
});

test('check: several reasons stack in rule order', () => {
  const r = v({ team_min: 3, fee: true, facts: { stated: false, same_college: true } });
  assert.deepEqual(r, { level: 'check', reasons: ['needs 3 members, recruit', 'form a same-college team', 'entry fee', 'eligibility not stated'] });
});

// ---- verdict: fits ---------------------------------------------------------------

test('fits: open listing, both members eligible, small team, free', () => {
  assert.deepEqual(v({}), { level: 'fits', reasons: [] });
  assert.deepEqual(v({ eligibility: el({ studentPassoutYearsSelected: [2028, 2029, 2030] }), team_min: 2 }), { level: 'fits', reasons: [] });
  assert.deepEqual(v({ eligibility: null, eligible_filters: ['All'] }), { level: 'fits', reasons: [] });
});

// ---- facts from the Unstop body (never stored) ------------------------------------

test('unstopFacts: same-college wording, and its negations', () => {
  const f = t => unstopFacts({ details_text: t, eligibility: el(), eligible_filters: ['All'] }).same_college;
  assert.equal(f('All team members must be from the same college.'), true);
  assert.equal(f('Cross-college teams are NOT eligible to participate.'), true);
  assert.equal(f('Inter-college teams are not allowed.'), true);
  assert.equal(f('Team members can be from different colleges.'), false);
  assert.equal(f('Members need not be from the same college.'), false);
  assert.equal(f('Members can be from the same or different institutes.'), false);
});

test('unstopFacts: women-only wording, stated from eligibility or filters', () => {
  assert.equal(unstopFacts({ details_text: 'Open to only female students across India.' }).women_only, true);
  assert.equal(unstopFacts({ details_text: 'An all-women hackathon.' }).women_only, true);
  assert.equal(unstopFacts({ details_text: 'Women and men welcome.' }).women_only, false);
  assert.equal(unstopFacts({ eligibility: null, eligible_filters: [] }).stated, false);
  assert.equal(unstopFacts({ eligibility: null, eligible_filters: ['All'] }).stated, true);
});

// ---- curated rows ----------------------------------------------------------------

test('curated: row verdicts from the verified team note', () => {
  assert.deepEqual(curatedHackVerdict({ indian_ug: 'no', indian_ug_note: 'school students only' }), { level: 'out', reasons: ['school students only'] });
  assert.deepEqual(curatedHackVerdict({ indian_ug: 'unclear', indian_ug_note: 'only Akshit is eligible by course' }), { level: 'check', reasons: ['only Akshit is eligible by course'] });
  assert.deepEqual(curatedHackVerdict({ indian_ug: 'unclear' }), { level: 'check', reasons: ['eligibility not stated'] });
  assert.deepEqual(curatedHackVerdict({ indian_ug: 'yes' }), { level: 'fits', reasons: [] });
});
