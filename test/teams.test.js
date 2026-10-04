import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  memberName, listingIndex, compOf, teamProgress, pendingByPerson, pendingByComp, myJoins, myRounds,
  isOverdue, roundEvents, roundClashItems, teamSummaries, defaultTeamEmails, roundsOf, membersOf,
  validInviteUrl, istDay,
} from '../lib/teams.js';

const today = '2026-10-05';
const people = [
  { email: 'krishnachagti@gmail.com', name: 'Krishna', role: 'admin', active: true },
  { email: 'akshit@gmail.com', name: 'Akshit', role: 'member', active: true },
  { email: 'riya@gmail.com', name: 'Riya', role: 'member', active: true },
  { email: 'old@gmail.com', name: 'Old', role: 'member', active: false },
];
const teams = [
  { listing_id: '101', section: 'case', invite_url: 'https://unstop.com/i/a' },
  { listing_id: 'df-x', section: 'hack', invite_url: 'https://devfolio.co/i/b' },
  { listing_id: '999', section: 'case', invite_url: 'https://unstop.com/i/c' },
];
const tm = [
  { listing_id: '101', email: 'krishnachagti@gmail.com', joined_at: '2026-10-01T05:00:00Z' },
  { listing_id: '101', email: 'riya@gmail.com', joined_at: null },
  { listing_id: 'df-x', email: 'krishnachagti@gmail.com', joined_at: null },
  { listing_id: 'df-x', email: 'akshit@gmail.com', joined_at: null },
  { listing_id: '999', email: 'riya@gmail.com', joined_at: '2026-10-02T20:00:00Z' },
];
const index = listingIndex(
  { case: [{ id: 101, title: 'Alpha Case', host: 'IIM A' }], hack: [{ id: 'df-x', title: 'Hack X', hack_kind: 'build' }] },
  { case: [{ id: 999, title: 'Old Case', archive_key: '999' }] },
);

test('memberName: the members table name, else the email local part', () => {
  assert.equal(memberName('RIYA@gmail.com', people), 'Riya');
  assert.equal(memberName('nobody.here@x.com', people), 'nobody.here');
  assert.equal(memberName('', people), '');
  assert.equal(memberName('a@b.c', undefined), 'a');
});

test('listingIndex: live by (section, id), archive fills gaps, live wins', () => {
  const ix = listingIndex({ case: [{ id: 5, title: 'Live' }] }, { case: [{ id: 5, title: 'Archived' }, { id: 6, title: 'Gone' }] });
  assert.equal(compOf(ix, { listing_id: '5', section: 'case' }).title, 'Live');
  assert.equal(compOf(ix, { listing_id: '5', section: 'case' }).archived, false);
  assert.equal(compOf(ix, { listing_id: '6', section: 'case' }).title, 'Gone');
  assert.equal(compOf(ix, { listing_id: '6', section: 'case' }).archived, true);
  // a team filed under the other section still finds the listing
  assert.equal(compOf(ix, { listing_id: '5', section: 'hack' }).title, 'Live');
  // unknown: a placeholder title, never undefined
  assert.equal(compOf(ix, { listing_id: '77', section: 'case' }).title, 'Listing 77');
  assert.equal(compOf(ix, { listing_id: '77', section: 'case' }).missing, true);
});

test('teamProgress counts joined of total and lists pending emails', () => {
  assert.deepEqual(teamProgress(teams[0], tm), { joined: 1, total: 2, pending: ['riya@gmail.com'] });
  assert.deepEqual(teamProgress(teams[1], tm), { joined: 0, total: 2, pending: ['akshit@gmail.com', 'krishnachagti@gmail.com'] });
  assert.deepEqual(teamProgress({ listing_id: 'none' }, tm), { joined: 0, total: 0, pending: [] });
});

test('membersOf / roundsOf filter by listing id', () => {
  assert.deepEqual(membersOf('101', tm).map(r => r.email), ['krishnachagti@gmail.com', 'riya@gmail.com']);
  assert.deepEqual(roundsOf('101', [{ id: 'a', listing_id: '101' }, { id: 'b', listing_id: '9' }]).map(r => r.id), ['a']);
});

test('pendingByPerson groups pending joins per email, with titles, skipping some emails', () => {
  const g = pendingByPerson(teams, tm, index);
  assert.deepEqual(g.map(p => p.email), ['akshit@gmail.com', 'krishnachagti@gmail.com', 'riya@gmail.com']);
  assert.deepEqual(g.find(p => p.email === 'riya@gmail.com').items.map(i => i.title), ['Alpha Case']);
  assert.equal(g[0].items[0].section, 'hack');
  assert.equal(g[0].items[0].listing_id, 'df-x');
  const withoutMe = pendingByPerson(teams, tm, index, { except: 'KRISHNACHAGTI@gmail.com' });
  assert.deepEqual(withoutMe.map(p => p.email), ['akshit@gmail.com', 'riya@gmail.com']);
});

test('pendingByPerson ignores team_members rows whose team is not visible', () => {
  const g = pendingByPerson([teams[0]], tm, index);
  assert.deepEqual(g.map(p => p.email), ['riya@gmail.com']);
});

test('pendingByComp lists teams with someone still to join', () => {
  const g = pendingByComp(teams, tm, index);
  assert.deepEqual(g.map(x => x.title), ['Alpha Case', 'Hack X']);
  assert.deepEqual(g[1].pending, ['akshit@gmail.com', 'krishnachagti@gmail.com']);
  assert.equal(g[1].total, 2);
});

test('myJoins: my teams I have not joined yet, with the invite link', () => {
  const j = myJoins('krishnachagti@gmail.com', teams, tm, index);
  assert.deepEqual(j.map(x => x.listing_id), ['df-x']);
  assert.equal(j[0].invite_url, 'https://devfolio.co/i/b');
  assert.equal(j[0].title, 'Hack X');
  assert.deepEqual(myJoins('riya@gmail.com', teams, tm, index).map(x => x.listing_id), ['101']);
  assert.deepEqual(myJoins('nobody@x.com', teams, tm, index), []);
});

test('isOverdue: undone with a due date before today (IST calendar dates)', () => {
  assert.equal(isOverdue({ due: '2026-10-04', done: false }, today), true);
  assert.equal(isOverdue({ due: '2026-10-05', done: false }, today), false);
  assert.equal(isOverdue({ due: '2026-10-04', done: true }, today), false);
  assert.equal(isOverdue({ due: null, done: false }, today), false);
  assert.equal(isOverdue({ due: 'garbage', done: false }, today), false);
});

test('istDay: a timestamp as its IST calendar date', () => {
  assert.equal(istDay('2026-10-02T20:00:00Z'), '2026-10-03');
  assert.equal(istDay(null), null);
});

const rounds = [
  { id: 'r1', listing_id: '101', name: 'Prelims deck', due: '2026-10-10', owner_email: null, done: false },
  { id: 'r2', listing_id: '101', name: 'Video', due: '2026-10-03', owner_email: 'riya@gmail.com', done: false },
  { id: 'r3', listing_id: '101', name: 'Finals', due: '2026-10-20', owner_email: 'krishnachagti@gmail.com', done: false },
  { id: 'r4', listing_id: 'df-x', name: 'Submission', due: null, owner_email: null, done: false },
  { id: 'r5', listing_id: '101', name: 'Old', due: '2026-09-01', owner_email: null, done: true },
  { id: 'r6', listing_id: 'df-x', name: 'Demo', due: '2026-10-08', owner_email: 'krishnachagti@gmail.com', done: false },
];

test('myRounds: undone rounds I own or that my team owns, by due date (undated last)', () => {
  const riya = myRounds('riya@gmail.com', teams, tm, rounds, today);
  assert.deepEqual(riya.map(r => r.id), ['r2', 'r1']);
  assert.equal(riya[0].overdue, true);
  assert.equal(riya[0].title, undefined); // titles are the page's business
  const krishna = myRounds('krishnachagti@gmail.com', teams, tm, rounds, today);
  assert.deepEqual(krishna.map(r => r.id), ['r6', 'r1', 'r3', 'r4']);
  // Akshit: team round in df-x only; r6 belongs to Krishna
  assert.deepEqual(myRounds('akshit@gmail.com', teams, tm, rounds, today).map(r => r.id), ['r4']);
});

test('myRounds: a round I own in a team I am not in still counts', () => {
  const r = [{ id: 'z', listing_id: '101', name: 'Z', due: '2026-10-09', owner_email: 'akshit@gmail.com', done: false }];
  assert.deepEqual(myRounds('akshit@gmail.com', teams, tm, r, today).map(x => x.id), ['z']);
});

test('roundEvents: one 📝 event per dated round, with its competition title and link section', () => {
  const ev = roundEvents(teams, rounds, index);
  assert.deepEqual(ev.map(e => e.round.id), ['r5', 'r2', 'r6', 'r1', 'r3']);
  const e = ev.find(x => x.round.id === 'r6');
  assert.equal(e.kind, 'round');
  assert.equal(e.date, '2026-10-08');
  assert.equal(e.title, 'Demo: Hack X');
  assert.equal(e.section, 'hack');
  assert.equal(e.listing_id, 'df-x');
  assert.equal(e.done, false);
  assert.equal(ev.find(x => x.round.id === 'r5').done, true);
  // rounds of a team that is not visible are skipped
  assert.deepEqual(roundEvents([teams[1]], rounds, index).map(x => x.round.id), ['r6']);
});

test('roundClashItems: undone dated rounds as committed dates, grouped with their competition', () => {
  const items = roundClashItems(teams, rounds, index);
  assert.deepEqual(items.map(i => i.id), ['round-r2', 'round-r6', 'round-r1', 'round-r3']);
  const i = items.find(x => x.id === 'round-r6');
  assert.equal(i.regn_close, '2026-10-08');
  assert.equal(i.team_of, 'df-x');
  assert.equal(i.title, 'Demo (Hack X)');
});

test('teamSummaries: progress, next undone round due and overdue count per team', () => {
  const s = teamSummaries(teams, tm, rounds, index, today);
  const a = s.find(x => x.listing_id === '101');
  assert.equal(a.title, 'Alpha Case');
  assert.equal(a.joined, 1);
  assert.equal(a.total, 2);
  assert.equal(a.next.id, 'r1');
  assert.equal(a.overdue, 1);
  const old = s.find(x => x.listing_id === '999');
  assert.equal(old.archived, true);
  assert.equal(old.next, null);
  // sorted: teams with a next due first (soonest), then the rest by title
  assert.deepEqual(s.map(x => x.listing_id), ['df-x', '101', '999']);
});

test('defaultTeamEmails: case = active roster minus Akshit; hack = Krishna + Akshit when they exist', () => {
  assert.deepEqual(defaultTeamEmails('case', people), ['krishnachagti@gmail.com', 'riya@gmail.com']);
  assert.deepEqual(defaultTeamEmails('hack', people), ['akshit@gmail.com', 'krishnachagti@gmail.com']);
  assert.deepEqual(defaultTeamEmails('hack', [people[2]]), []);
  assert.deepEqual(defaultTeamEmails('hack', [{ ...people[1], active: false }]), []);
});

test('validInviteUrl: https only, no spaces, at most 1000 characters', () => {
  assert.equal(validInviteUrl(' https://unstop.com/x '), 'https://unstop.com/x');
  assert.equal(validInviteUrl('http://unstop.com/x'), null);
  assert.equal(validInviteUrl('javascript:alert(1)'), null);
  assert.equal(validInviteUrl('https://a b'), null);
  assert.equal(validInviteUrl(`https://x.com/${'a'.repeat(1000)}`), null);
  assert.equal(validInviteUrl(''), null);
});
