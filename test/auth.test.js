import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, isGithubIo, roleCan, radarUrl, RADAR_HOME, hasAuthParams, authError, authCode, signInUrl, readSession, SESSION_KEY, memberHome, MEMBER_PAGE } from '../lib/auth.js';

test('cleanUrl strips only radar_code and radar_error, keeping id, s and the hash', () => {
  assert.equal(
    cleanUrl('https://conyso.com/certamus/radar/c.html?id=123&s=hack&radar_code=abc#top'),
    'https://conyso.com/certamus/radar/c.html?id=123&s=hack#top');
  assert.equal(cleanUrl('https://conyso.com/certamus/radar/?radar_code=abc'), 'https://conyso.com/certamus/radar/');
  assert.equal(cleanUrl('https://conyso.com/certamus/radar/all.html?s=hack'), 'https://conyso.com/certamus/radar/all.html?s=hack');
  assert.equal(cleanUrl('https://conyso.com/certamus/radar/c.html?radar_error=failed&id=intl-a'), 'https://conyso.com/certamus/radar/c.html?id=intl-a');
  // Other pages' parameters with similar names are left alone.
  assert.equal(cleanUrl('https://conyso.com/certamus/radar/?code=1&state=2'), 'https://conyso.com/certamus/radar/?code=1&state=2');
});

test('cleanUrl takes a Location-like object', () => {
  assert.equal(cleanUrl({ href: 'https://conyso.com/certamus/radar/index.html?s=hack&radar_code=q' }),
    'https://conyso.com/certamus/radar/index.html?s=hack');
});

test('hasAuthParams sees radar_code or radar_error; authCode reads the code', () => {
  assert.equal(hasAuthParams('https://x.com/?radar_code=1'), true);
  assert.equal(hasAuthParams('https://x.com/?id=1&radar_error=failed'), true);
  assert.equal(hasAuthParams('https://x.com/?id=1&s=hack'), false);
  assert.equal(hasAuthParams('not a url'), false);
  assert.equal(authCode('https://x.com/?radar_code=abc&id=1'), 'abc');
  assert.equal(authCode('https://x.com/?radar_code=&id=1'), null);
  assert.equal(authCode('https://x.com/'), null);
});

test('signInUrl: the API\'s /auth/google with this page, cleaned, as the way back', () => {
  const u = new URL(signInUrl('https://conyso.com/certamus/radar/c.html?id=5&s=hack&radar_error=failed#x', 'https://api.test/'));
  assert.equal(u.origin + u.pathname, 'https://api.test/auth/google');
  assert.equal(u.searchParams.get('return'), 'https://conyso.com/certamus/radar/c.html?id=5&s=hack#x');
  assert.match(signInUrl('https://conyso.com/certamus/radar/'), /^https:\/\/[^/]+\/auth\/google\?return=https%3A%2F%2Fconyso\.com/);
});

test('readSession: a stored, unexpired token or null', () => {
  const store = v => ({ getItem: k => (k === SESSION_KEY ? v : null) });
  const now = Date.parse('2026-10-05T00:00:00Z');
  assert.deepEqual(readSession(store('{"token":"t","expires_at":"2026-11-04T00:00:00Z"}'), now), { token: 't', expires_at: '2026-11-04T00:00:00Z' });
  assert.equal(readSession(store('{"token":"t","expires_at":"2026-10-04T00:00:00Z"}'), now), null, 'expired');
  assert.equal(readSession(store('{"token":""}'), now), null);
  assert.equal(readSession(store('not json'), now), null);
  assert.equal(readSession(store(null), now), null);
  assert.equal(readSession({ getItem() { throw new Error('blocked'); } }, now), null);
  assert.equal(readSession(undefined, now), null);
});

test('isGithubIo: the github.io pages host only', () => {
  assert.equal(isGithubIo('krishnachagti-sudo.github.io'), true);
  assert.equal(isGithubIo('KRISHNACHAGTI-SUDO.GITHUB.IO'), true);
  assert.equal(isGithubIo('github.io'), true);
  assert.equal(isGithubIo('conyso.com'), false);
  assert.equal(isGithubIo('localhost'), false);
  assert.equal(isGithubIo('github.io.evil.com'), false);
  assert.equal(isGithubIo(''), false);
  assert.equal(isGithubIo(undefined), false);
});

test('radarUrl keeps the page, id and section on the conyso.com address', () => {
  assert.equal(RADAR_HOME, 'https://conyso.com/certamus/radar/');
  assert.equal(radarUrl('https://krishnachagti-sudo.github.io/certamus-radar/c.html?id=5&s=hack'),
    'https://conyso.com/certamus/radar/c.html?id=5&s=hack');
  assert.equal(radarUrl('https://krishnachagti-sudo.github.io/certamus-radar/'), 'https://conyso.com/certamus/radar/');
  assert.equal(radarUrl('https://krishnachagti-sudo.github.io/certamus-radar/calendar.html'), 'https://conyso.com/certamus/radar/calendar.html');
  // Only the radar's own pages are carried over.
  assert.equal(radarUrl('https://krishnachagti-sudo.github.io/certamus-radar/evil.html?x=1'), 'https://conyso.com/certamus/radar/');
  assert.equal(radarUrl('not a url'), 'https://conyso.com/certamus/radar/');
});

test('roleCan: admin does everything; a member only marks their own join', () => {
  const admin = { email: 'a@x.com', name: 'A', role: 'admin' };
  const member = { email: 'm@x.com', name: 'M', role: 'member' };
  for (const action of ['read', 'edit', 'manage_teams', 'mark_joined', 'round_done']) assert.equal(roleCan(admin, action), true, action);
  assert.equal(roleCan(member, 'mark_joined'), true);
  for (const action of ['read', 'round_done', 'edit', 'manage_teams']) assert.equal(roleCan(member, action), false, action);
});

test('memberHome: the team page next to the current one, nothing carried over', () => {
  assert.equal(MEMBER_PAGE, 'team.html');
  assert.equal(memberHome('https://conyso.com/certamus/radar/c.html?id=5&s=hack#x'), 'https://conyso.com/certamus/radar/team.html');
  assert.equal(memberHome('https://conyso.com/certamus/radar/'), 'https://conyso.com/certamus/radar/team.html');
  assert.equal(memberHome({ href: 'http://localhost:8080/calendar.html?s=hack' }), 'http://localhost:8080/team.html');
  assert.equal(memberHome('not a url'), 'team.html');
});

test('roleCan: nobody, inactive, unknown roles and unknown actions get nothing', () => {
  assert.equal(roleCan(null, 'read'), false);
  assert.equal(roleCan(undefined, 'edit'), false);
  assert.equal(roleCan({ role: 'admin', active: false }, 'edit'), false);
  assert.equal(roleCan({ role: 'owner' }, 'read'), false);
  assert.equal(roleCan({ role: 'admin' }, 'drop_tables'), false);
  assert.equal(roleCan({ role: 'admin' }, '__proto__'), false);
});

test('authError: the API\'s reason codes as plain words; anything else is a generic failure', () => {
  assert.match(authError('https://x.com/?radar_error=not_member'), /^Not on the team list/);
  assert.equal(authError('https://x.com/?radar_error=cancelled'), 'Google sign-in was cancelled.');
  assert.match(authError('https://x.com/?radar_error=expired'), /took too long/);
  assert.match(authError('https://x.com/?radar_error=failed'), /did not complete/);
  assert.match(authError('https://x.com/?radar_error=<script>'), /did not complete/, 'never echoes the URL');
  assert.match(authError('https://x.com/?radar_error=__proto__'), /did not complete/);
  assert.equal(authError('https://x.com/?id=1#top'), null);
  assert.equal(authError('not a url'), null);
});
