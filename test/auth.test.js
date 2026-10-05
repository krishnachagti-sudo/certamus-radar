import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUrl, isGithubIo, roleCan, radarUrl, RADAR_HOME, hasAuthParams, authError, memberHome, MEMBER_PAGE } from '../lib/auth.js';

test('cleanUrl strips only code and state, keeping id, s and the hash', () => {
  assert.equal(
    cleanUrl('https://conyso.com/certamus/radar/c.html?id=123&s=hack&code=abc&state=xyz#top'),
    'https://conyso.com/certamus/radar/c.html?id=123&s=hack#top');
  assert.equal(cleanUrl('https://conyso.com/certamus/radar/?code=abc'), 'https://conyso.com/certamus/radar/');
  assert.equal(cleanUrl('https://conyso.com/certamus/radar/all.html?s=hack'), 'https://conyso.com/certamus/radar/all.html?s=hack');
  assert.equal(cleanUrl('https://conyso.com/certamus/radar/c.html?state=1&id=intl-a'), 'https://conyso.com/certamus/radar/c.html?id=intl-a');
});

test('cleanUrl takes a Location-like object', () => {
  assert.equal(cleanUrl({ href: 'https://conyso.com/certamus/radar/index.html?s=hack&code=q' }),
    'https://conyso.com/certamus/radar/index.html?s=hack');
});

test('hasAuthParams sees code or state', () => {
  assert.equal(hasAuthParams('https://x.com/?code=1'), true);
  assert.equal(hasAuthParams('https://x.com/?id=1&state=2'), true);
  assert.equal(hasAuthParams('https://x.com/?id=1&s=hack'), false);
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

test('cleanUrl also strips a failed sign-in\'s error, error_code and error_description', () => {
  assert.equal(
    cleanUrl('https://conyso.com/certamus/radar/c.html?id=7&error=access_denied&error_code=403&error_description=Nope#top'),
    'https://conyso.com/certamus/radar/c.html?id=7#top');
  assert.equal(
    cleanUrl('https://conyso.com/certamus/radar/?s=hack#error=server_error&error_code=500&error_description=Bad'),
    'https://conyso.com/certamus/radar/?s=hack');
  assert.equal(hasAuthParams('https://x.com/?error=access_denied'), true);
  assert.equal(hasAuthParams('https://x.com/#error_description=x'), true);
  assert.equal(hasAuthParams('https://x.com/#top'), false);
});

test('authError reads the error description from the query or the hash', () => {
  assert.equal(authError('https://x.com/?error=access_denied&error_description=Access+denied+by+user'), 'Access denied by user');
  assert.equal(authError('https://x.com/#error=server_error&error_code=500&error_description=Database%20error'), 'Database error');
  assert.equal(authError('https://x.com/?error=access_denied'), 'access_denied');
  assert.equal(authError('https://x.com/?id=1#top'), null);
  assert.equal(authError('not a url'), null);
});
