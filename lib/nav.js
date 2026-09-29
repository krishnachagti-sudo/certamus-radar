// Shared nav: Board · All case comps · Calendar · Hosts & archive.
const PAGES = [
  ['board', 'index.html', 'Board'],
  ['all', 'all.html', 'All case comps'],
  ['calendar', 'calendar.html', 'Calendar'],
  ['hosts', 'hosts.html', 'Hosts & archive'],
];

export const navHtml = current => `<strong>Certamus Radar</strong>${PAGES
  .map(([key, href, label]) => `<a href="${href}"${key === current ? ' aria-current="page"' : ''}>${label.replace('&', '&amp;')}</a>`).join('')}`;

export function mountNav(current) {
  const el = document.getElementById('nav');
  if (el) el.innerHTML = navHtml(current);
}
