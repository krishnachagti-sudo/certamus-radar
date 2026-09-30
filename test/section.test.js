import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTIONS, sectionFrom, otherSection, pageHref, HACK_TIERS, HACK_BOARD_TIERS, tierLabel,
} from '../lib/section.js';
import { compHref } from '../lib/card.js';
import { navHtml } from '../lib/nav.js';

test('sectionFrom: ?s=hack is the hackathon section, anything else case comps', () => {
  assert.equal(sectionFrom('?s=hack'), 'hack');
  assert.equal(sectionFrom('?id=5&s=hack'), 'hack');
  assert.equal(sectionFrom(''), 'case');
  assert.equal(sectionFrom(undefined), 'case');
  assert.equal(sectionFrom('?s=case'), 'case');
  assert.equal(sectionFrom('?s=<x>'), 'case');
});

test('sectionFrom: a hackathon-only id prefix implies the section when s is missing', () => {
  for (const id of ['df-abc', 'mlh-x', 'dp-3', 'hk-sih']) assert.equal(sectionFrom(`?id=${id}`), 'hack', id);
  assert.equal(sectionFrom('?id=1752198'), 'case');
  assert.equal(sectionFrom('?id=intl-icbc'), 'case');
  assert.equal(sectionFrom('?id=df-abc&s=case'), 'case');
});

test('otherSection flips', () => {
  assert.equal(otherSection('case'), 'hack');
  assert.equal(otherSection('hack'), 'case');
});

test('data files per section', () => {
  assert.deepEqual(SECTIONS.case.files, {
    items: 'competitions.json', status: 'status.json', archive: 'archive.json', curated: ['international.json', 'fests.json'],
  });
  assert.deepEqual(SECTIONS.hack.files, {
    items: 'hackathons.json', status: 'hack-status.json', archive: 'hack-archive.json', curated: ['hack-curated.json'],
  });
});

test('hackathon tiers: board default and labels', () => {
  assert.deepEqual(HACK_BOARD_TIERS, ['iit', 'iim', 'national', 'bschool', 'corporate', 'global']);
  assert.deepEqual(Object.keys(HACK_TIERS), ['iit', 'iim', 'national', 'bschool', 'corporate', 'global', 'other']);
  assert.equal(HACK_TIERS.global, 'Global online & abroad');
  assert.equal(tierLabel('global'), 'Global online & abroad');
  assert.equal(tierLabel('international'), 'International');
  assert.equal(tierLabel('weird'), 'weird');
});

test('wording per section', () => {
  assert.equal(SECTIONS.case.plural, 'case comps');
  assert.equal(SECTIONS.hack.plural, 'hackathons');
  assert.equal(SECTIONS.hack.pages.all.h1, 'All hackathons');
  assert.match(SECTIONS.hack.pages.board.title, /Hackathons/);
});

test('pageHref carries the section; the case section keeps its bare links', () => {
  assert.equal(pageHref('index.html', 'case'), 'index.html');
  assert.equal(pageHref('index.html', 'hack'), 'index.html?s=hack');
  assert.equal(pageHref('calendar.html', 'hack'), 'calendar.html?s=hack');
});

test('compHref: case links unchanged, hackathon links carry s=hack, ids encoded', () => {
  assert.equal(compHref(1752198, 'case'), 'c.html?id=1752198');
  assert.equal(compHref(1752198), 'c.html?id=1752198');
  assert.equal(compHref('df-abc', 'hack'), 'c.html?id=df-abc&s=hack');
  assert.equal(compHref('a&b"<', 'hack'), 'c.html?id=a%26b%22%3C&s=hack');
});

test('nav: the section switch marks the current section and keeps the page', () => {
  const html = navHtml('calendar', 'hack');
  assert.match(html, /<a href="calendar.html"[^>]*>Case comps<\/a>/);
  assert.match(html, /<a href="calendar.html\?s=hack" aria-current="true">Hackathons<\/a>/);
  assert.match(html, /<a href="index.html\?s=hack">Board<\/a>/);
  assert.match(html, /<a href="all.html\?s=hack">All hackathons<\/a>/);
  assert.match(html, /<a href="calendar.html\?s=hack" aria-current="page">Calendar<\/a>/);
  const caseHtml = navHtml('board', 'case');
  assert.match(caseHtml, /<a href="index.html" aria-current="true">Case comps<\/a>/);
  assert.match(caseHtml, /<a href="index.html\?s=hack">Hackathons<\/a>/);
  assert.match(caseHtml, /<a href="all.html">All case comps<\/a>/);
});

test('nav on the competition page: the switch goes to the other Board', () => {
  const html = navHtml(null, 'hack');
  assert.match(html, /<a href="index.html">Case comps<\/a>/);
  assert.match(html, /<a href="index.html\?s=hack" aria-current="true">Hackathons<\/a>/);
});
