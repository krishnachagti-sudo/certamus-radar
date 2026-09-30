import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDevfolio, devfolioRecords, DEVFOLIO_URL } from '../fetch/devfolio.js';
import { fetchMlh, parseMlh, mlhRecords, mlhSeason, mlhUrl } from '../fetch/mlh.js';
import { fetchDevpost, devpostRecords, parseDevpostEnd, devpostUrl } from '../fetch/devpost.js';

const pause = async () => {};
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z.]{2,}/;
const PHONE = /\b[6-9][0-9]{9}\b/;

// ---- Devfolio ---------------------------------------------------------------------

const df = (over = {}) => ({
  uuid: '6ecaa82827354b4cb56968d1c2b14faa', slug: 'codeutsava-x', name: 'Codeutsava X.0', hosted_by: null,
  location: 'NIT Raipur, Great Eastern Road, Amanaka, Raipur, Chhattisgarh, India', city: 'Raipur', country: 'India',
  is_online: false, starts_at: '2026-10-03T03:30:00+00:00', ends_at: '2026-10-04T10:00:00+00:00', team_min: 2, team_size: 4,
  desc: 'Mail organiser@example.com or call 9876543210',
  hackathon_setting: { reg_ends_at: '2026-09-30T18:29:00+00:00', women_only: false, contact_email: 'organiser@example.com' },
  hackathon_faqs: [{ question: 'Who can participate?', answer: 'Students from any college. Write to organiser@example.com' }],
  participants_details: [{ first_name: 'A', last_name: 'B' }],
  ...over,
});

test('Devfolio: POSTs application_open pages of 50 and stops at the total', async () => {
  const calls = [];
  const postJson = async (url, body) => {
    calls.push([url, body]);
    const hits = Array.from({ length: body.from === 0 ? 50 : 10 }, (_, i) => ({ _source: df({ uuid: String(body.from + i).padStart(32, 'a') }) }));
    return { hits: { total: { value: 60 }, hits } };
  };
  const hits = await fetchDevfolio({ postJson, pause });
  assert.equal(hits.length, 60);
  assert.deepEqual(calls.map(c => c[1]), [{ type: 'application_open', from: 0, size: 50 }, { type: 'application_open', from: 50, size: 50 }]);
  assert.equal(calls[0][0], DEVFOLIO_URL);
});

test('Devfolio: a changed shape throws', async () => {
  await assert.rejects(fetchDevfolio({ postJson: async () => ({ results: [] }), pause }), /shape/);
});

test('Devfolio: record id, slug url, venue host, IST dates, team sizes; no FAQ, desc or contact text', () => {
  const [r] = devfolioRecords([df()]);
  assert.equal(r.id, 'df-6ecaa82827354b4cb56968d1c2b14faa');
  assert.equal(r.url, 'https://codeutsava-x.devfolio.co/');
  assert.equal(r.host, 'NIT Raipur');
  assert.equal(r.regn_close, '2026-09-30'); // 18:29 UTC is 23:59 IST
  assert.equal(r.comp_start, '2026-10-03');
  assert.equal(r.team_min, 2);
  assert.equal(r.team_max, 4);
  assert.equal(r.mode, 'offline');
  assert.equal(r.facts.stated, true);
  assert.equal(r.facts.abroad, null);
  const published = JSON.stringify({ ...r, facts: undefined });
  assert.doesNotMatch(published, EMAIL);
  assert.doesNotMatch(published, PHONE);
  assert.doesNotMatch(published, /Great Eastern/);
});

test('Devfolio: a city-only venue gives no host; hosted_by wins when set', () => {
  assert.equal(devfolioRecords([df({ location: 'Kolkata, West Bengal, India' })])[0].host, '');
  assert.equal(devfolioRecords([df({ hosted_by: { name: 'ETHIndia' } })])[0].host, 'ETHIndia');
});

test('Devfolio: in person outside India is abroad; online is not; women_only and same-college FAQs are facts', () => {
  assert.equal(devfolioRecords([df({ country: 'Germany', city: 'München' })])[0].facts.abroad, 'Germany');
  assert.equal(devfolioRecords([df({ country: 'Germany', is_online: true })])[0].facts.abroad, null);
  assert.equal(devfolioRecords([df({ hackathon_setting: { women_only: true } })])[0].facts.women_only, true);
  const same = df({ hackathon_faqs: [{ question: 'Team rules?', answer: 'All members must be from the same college.' }] });
  const [r] = devfolioRecords([same]);
  assert.equal(r.facts.same_college, true);
  assert.equal(r.facts.stated, false);
});

test('Devfolio: malformed hits are skipped', () => {
  assert.equal(devfolioRecords([null, df({ uuid: 'x' }), df({ slug: 'bad slug' }), df({ name: '' })]).length, 0);
});

// ---- MLH ------------------------------------------------------------------------------

const ev = (over = {}) => ({
  id: '019f', slug: 'bigred-hacks-2026', name: 'BigRed//Hacks 2026', status: 'pending',
  startsAt: '2026-10-02T20:30:00Z', endsAt: '2026-10-04T17:00:00Z', url: '/events/bigred-hacks-2026/prizes',
  location: 'Ithaca, New York', formatType: 'physical', websiteUrl: 'https://www.bigredhacks.com/',
  customFields: { underserved_types: [], hackathon_focus: [] }, venueAddress: { city: 'Ithaca', state: 'New York', country: 'US' }, ...over,
});
const mlhPage = events => `<html><script data-page="app" type="application/json">${JSON.stringify({ component: 'EventsListing', props: { upcomingEvents: events, pastEvents: [] } })}</script></html>`;

test('MLH: the season is named for the year it ends (Aug–Jul)', () => {
  assert.equal(mlhSeason(new Date('2026-09-30T00:00:00Z')), 2027);
  assert.equal(mlhSeason(new Date('2027-03-01T00:00:00Z')), 2027);
  assert.equal(mlhSeason(new Date('2026-07-31T12:00:00Z')), 2026);
  assert.equal(mlhUrl(2027), 'https://www.mlh.com/seasons/2027/events');
});

test('MLH: fetches the current season page once', async () => {
  const urls = [];
  await fetchMlh({ getText: async u => { urls.push(u); return ''; }, pause, now: new Date('2026-09-30T00:00:00Z') });
  assert.deepEqual(urls, ['https://www.mlh.com/seasons/2027/events']);
});

test('MLH: parses upcomingEvents from the Inertia payload; no payload throws', () => {
  assert.equal(parseMlh(mlhPage([ev(), ev({ slug: 'b' })])).length, 2);
  assert.throws(() => parseMlh('<html></html>'), /shape/);
});

test('MLH: record id, site url, in-person abroad, start as registration close', () => {
  const [r] = mlhRecords([ev()]);
  assert.equal(r.id, 'mlh-bigred-hacks-2026');
  assert.equal(r.url, 'https://www.bigredhacks.com/');
  assert.equal(r.mode, 'offline');
  assert.equal(r.regn_close, '2026-10-03');
  assert.equal(r.comp_end, '2026-10-04');
  assert.equal(r.facts.abroad, 'US');
  assert.equal(r.facts.stated, false);
});

test('MLH: online and Indian events are not abroad; high-school-only and women-only are facts', () => {
  assert.equal(mlhRecords([ev({ formatType: 'digital' })])[0].facts.abroad, null);
  assert.equal(mlhRecords([ev({ venueAddress: { country: 'IN' } })])[0].facts.abroad, null);
  assert.equal(mlhRecords([ev({ customFields: { underserved_types: ['High School Students Only'] } })])[0].facts.school_only, true);
  assert.equal(mlhRecords([ev({ customFields: { underserved_types: ['Women Only'] } })])[0].facts.women_only, true);
  assert.equal(mlhRecords([ev({ formatType: 'hybrid_physical' })])[0].mode, 'hybrid');
});

test('MLH: an http website falls back to the MLH event page; bad slugs are skipped', () => {
  assert.equal(mlhRecords([ev({ websiteUrl: 'http://x.com' })])[0].url, 'https://www.mlh.com/events/bigred-hacks-2026/prizes');
  assert.equal(mlhRecords([ev({ slug: '../x' })]).length, 0);
});

// ---- Devpost ----------------------------------------------------------------------------

const dp = (over = {}) => ({
  id: 29969, title: 'RevenueCat Shipaton 2026', displayed_location: { icon: 'globe', location: 'Online' }, open_state: 'open',
  url: 'https://revenuecat-shipaton-2026.devpost.com/', submission_period_dates: 'Jul 31 - Oct 01, 2026',
  organization_name: 'RevenueCat', invite_only: false, ...over,
});

test('Devpost: pages by meta.total_count with status[]=open', async () => {
  const urls = [];
  const getJson = async u => {
    urls.push(u);
    const page = Number(new URL(u).searchParams.get('page'));
    return { hackathons: page < 3 ? Array.from({ length: 9 }, (_, i) => dp({ id: page * 100 + i })) : [dp({ id: 999 })], meta: { total_count: 19 } };
  };
  const list = await fetchDevpost({ getJson, pause });
  assert.equal(list.length, 19);
  assert.equal(urls.length, 3);
  assert.equal(new URL(devpostUrl(1)).searchParams.get('status[]'), 'open');
});

test('Devpost: end-date parsing', () => {
  assert.equal(parseDevpostEnd('Jul 31 - Oct 01, 2026'), '2026-10-01');
  assert.equal(parseDevpostEnd('Oct 01 - 05, 2026'), '2026-10-05');
  assert.equal(parseDevpostEnd('Dec 15, 2026 - Jan 10, 2027'), '2027-01-10');
  assert.equal(parseDevpostEnd('Oct 01, 2026'), '2026-10-01');
  assert.equal(parseDevpostEnd('soon'), null);
});

test('Devpost: record id, url, online, invite-only and in-person abroad facts', () => {
  const [r] = devpostRecords([dp()]);
  assert.equal(r.id, 'dp-29969');
  assert.equal(r.regn_close, '2026-10-01');
  assert.equal(r.mode, 'online');
  assert.equal(r.facts.abroad, null);
  assert.equal(devpostRecords([dp({ invite_only: true })])[0].facts.invite_only, true);
  assert.equal(devpostRecords([dp({ displayed_location: { icon: 'map-marker', location: 'Stanford University' } })])[0].facts.abroad, 'Stanford University');
  assert.equal(devpostRecords([dp({ url: 'https://evil.example.com/' })]).length, 0);
});
