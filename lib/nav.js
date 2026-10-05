// Shared nav: the Case comps | Hackathons switch, then Board · All · Calendar
// · Hosts & archive · Team (both sections), every link in the current section. Switching sections
// keeps the page (the competition page switches to the other Board). The
// signed-in member's name and a Sign out button (handled in lib/auth.js) end it.
// Teammates get memberNavHtml instead: the title, their name, Sign out.
import { SECTIONS, currentSection, pageHref, sectionOf } from './section.js';
import { esc } from './card.js';

const PAGES = [
  ['board', 'index.html', () => 'Board'],
  ['all', 'all.html', s => `All ${s.plural}`],
  ['calendar', 'calendar.html', () => 'Calendar'],
  ['hosts', 'hosts.html', () => 'Hosts & archive'],
  ['team', 'team.html', () => 'Team'],
];

const amp = t => t.replace(/&/g, '&amp;');

const whoHtml = member => (member
  ? `<span class="who"><span class="who-name">${esc(member.name || member.email)}</span><button type="button" class="ghost" id="signout">Sign out</button></span>`
  : '');

export function navHtml(current, section = 'case', member = null) {
  const sec = sectionOf(section);
  const file = PAGES.find(([key]) => key === current)?.[1] || 'index.html';
  const sw = ['case', 'hack'].map(k => `<a href="${pageHref(file, k)}"${k === sec.key ? ' aria-current="true"' : ''}>${SECTIONS[k].switchLabel}</a>`).join('');
  const pages = PAGES
    .map(([key, href, label]) => `<a href="${pageHref(href, sec.key)}"${key === current ? ' aria-current="page"' : ''}>${amp(label(sec))}</a>`).join('');
  return `<strong>Certamus Radar</strong><span class="sw" role="group" aria-label="Section">${sw}</span><span class="pages">${pages}</span>${whoHtml(member)}`;
}

// The teammates' header: nothing to navigate to.
export const memberNavHtml = member => `<strong>Certamus Radar</strong>${whoHtml(member)}`;

export function mountMemberNav(member) {
  const el = document.getElementById('nav');
  if (el) el.innerHTML = memberNavHtml(member);
}

// The hackathon section rewrites the static page header and title.
function applyHeader(current, sec) {
  const page = sec.pages[current];
  if (!page || sec.key === 'case') return;
  document.title = page.title;
  const h1 = document.querySelector('.top h1');
  const p = document.querySelector('.top p');
  if (h1 && page.h1) h1.textContent = page.h1;
  if (p && page.intro) p.textContent = page.intro;
}

export function mountNav(current, member = null) {
  const section = currentSection();
  const el = document.getElementById('nav');
  if (el) el.innerHTML = navHtml(current, section, member);
  applyHeader(current, sectionOf(section));
}
