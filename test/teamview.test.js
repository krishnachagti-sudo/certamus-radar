import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  teamSectionHtml, inviteHtml, joinRowHtml, teamInboxHtml, waitingHtml, allTeamsHtml, dueText, shortDay, myRoundRowHtml,
} from '../lib/teamview.js';

const today = '2026-10-05';
const EVIL = '<img src=x onerror=alert(1)>"\'&';
const members = [
  { email: 'krishnachagti@gmail.com', name: 'Krishna', role: 'admin', active: true },
  { email: 'evil@x.com', name: EVIL, role: 'member', active: true },
];
const team = { listing_id: '101', section: 'case', invite_url: 'https://unstop.com/i?a=1&b="><script>alert(1)</script>' };
const base = {
  team, members, viewer: 'evil@x.com', isAdmin: false, today, title: EVIL,
  teamMembers: [
    { listing_id: '101', email: 'krishnachagti@gmail.com', joined_at: '2026-10-02T20:00:00Z' },
    { listing_id: '101', email: 'evil@x.com', joined_at: null },
  ],
  rounds: [
    { id: 'r1', listing_id: '101', name: EVIL, due: '2026-10-01', owner_email: 'evil@x.com', done: false },
    { id: 'r2', listing_id: '101', name: 'Finals', due: '2026-10-20', owner_email: null, done: true },
  ],
  teamForm: null, roundForm: null, busy: false, msg: '',
};

const noRawTags = html => {
  assert.ok(!html.includes('<img'), 'raw <img');
  assert.ok(!html.includes('<script'), 'raw <script');
};

test('team section escapes member names, round names and the invite link', () => {
  const html = teamSectionHtml(base);
  noRawTags(html);
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
  // the link went through safeHref (URL-encoded) and esc
  assert.ok(html.includes('href="https://unstop.com/i?a=1&amp;b=%22%3E%3Cscript%3Ealert(1)%3C/script%3E"'));
  assert.ok(html.includes('1/2 joined'));
  assert.ok(html.includes('✓ joined 3 Oct'));
  // the viewer's own pending row has "I've joined"; no admin controls
  assert.match(html, /data-join="101" data-joined="1"/);
  assert.ok(!html.includes('id="team-edit"'));
  assert.ok(!html.includes('data-round-edit'));
  // overdue undone round is marked; done round is ticked
  assert.match(html, /class="rd-row overdue"/);
  assert.match(html, /data-round-done="r2" data-focus="rdone:r2" checked/);
});

test('a joined viewer gets Undo; the admin gets edit, delete and round controls', () => {
  const html = teamSectionHtml({ ...base, viewer: 'krishnachagti@gmail.com', isAdmin: true });
  assert.match(html, /data-join="101" data-joined="0"/);
  assert.ok(html.includes('id="team-edit"') && html.includes('id="team-delete"'));
  assert.ok(html.includes('data-round-edit="r1"') && html.includes('id="round-add"'));
});

test('no team: nothing for a member; Create team for the admin', () => {
  assert.equal(teamSectionHtml({ ...base, team: null, teamMembers: [], rounds: [] }), '');
  const html = teamSectionHtml({ ...base, team: null, teamMembers: [], rounds: [], isAdmin: true });
  assert.ok(html.includes('id="team-create"'));
  const form = teamSectionHtml({
    ...base, team: null, teamMembers: [], rounds: [], isAdmin: true,
    teamForm: { mode: 'create', emails: new Set(['evil@x.com']), url: '"><b>x' },
  });
  noRawTags(form);
  assert.ok(!form.includes('"><b>'));
  assert.match(form, /value="evil@x.com" data-focus="pick:evil@x.com" checked/);
  assert.match(form, /value="krishnachagti@gmail.com" data-focus="pick:krishnachagti@gmail.com">/);
});

test('round form: owner select is Team plus the team members, escaped', () => {
  const html = teamSectionHtml({ ...base, isAdmin: true, roundForm: { id: 'r1', name: EVIL, due: '2026-10-01', owner: 'evil@x.com' } });
  noRawTags(html);
  assert.match(html, /<option value="">Team<\/option>/);
  assert.match(html, /<option value="evil@x.com" selected>&lt;img/);
  assert.ok(html.includes('Save round'));
});

test('inviteHtml refuses anything but https', () => {
  assert.match(inviteHtml('javascript:alert(1)', 'f'), /not an https link/);
  assert.ok(!inviteHtml('javascript:alert(1)', 'f').includes('javascript'));
});

test('join rows, waiting list and all teams escape titles and names', () => {
  const item = { listing_id: 'df-"x', section: 'hack', title: EVIL, invite_url: 'https://d.co/i', archived: false };
  const row = joinRowHtml(item);
  noRawTags(row);
  assert.ok(row.includes('href="c.html?id=df-%22x&amp;s=hack"'));
  assert.ok(row.includes('id="join-url-df-_x"'));
  const w = waitingHtml([{ email: 'evil@x.com', items: [item] }], members);
  noRawTags(w);
  assert.ok(w.includes('Waiting on teammates (1)'));
  const all = allTeamsHtml([{ ...item, joined: 1, total: 3, next: { name: EVIL, due: '2026-10-06' }, overdue: 2 }], today);
  noRawTags(all);
  assert.ok(all.includes('1/3 joined') && all.includes('due tomorrow') && all.includes('2 overdue rounds'));
  const mr = myRoundRowHtml({ id: 'r', name: EVIL, due: '2026-10-01', overdue: true, owner_email: null }, item, today);
  noRawTags(mr);
});

test('teamInboxHtml shows whichever applies, empty string when nothing does', () => {
  const item = { listing_id: '1', section: 'case', title: 'A', invite_url: 'https://u.com/i' };
  assert.equal(teamInboxHtml({ joins: [], waiting: [], members, isAdmin: true }), '');
  const m = teamInboxHtml({ joins: [item], waiting: [{ email: 'evil@x.com', items: [item] }], members, isAdmin: false });
  assert.ok(m.includes('Join these teams (1)') && !m.includes('Waiting on teammates'));
  const a = teamInboxHtml({ joins: [], waiting: [{ email: 'evil@x.com', items: [item, item] }], members, isAdmin: true });
  assert.ok(a.includes('Waiting on teammates (2)') && !a.includes('Join these teams'));
});

test('dueText and shortDay', () => {
  assert.equal(dueText({ due: '2026-10-04' }, today), 'overdue since 4 Oct');
  assert.equal(dueText({ due: '2026-10-05' }, today), 'due today');
  assert.equal(dueText({ due: '2027-01-02' }, today), 'due 2 Jan 2027');
  assert.equal(dueText({ due: '2026-10-04', done: true }, today), 'due 4 Oct');
  assert.equal(dueText({ due: null }, today), 'no due date');
  assert.equal(shortDay('bad', today), '');
});
