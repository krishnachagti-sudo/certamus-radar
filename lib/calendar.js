// Pure layout rules for the Calendar page: month cells, events per day, clash
// days, agenda weeks and the "expected" markers for curated international
// items. Dates are 'YYYY-MM-DD' strings (IST calendar dates); months are 1-12.
// Browser-safe: imports only relative modules, never touches the DOM.
import { dayDiff } from '../dates.js';
import { WINDOW_DAYS } from '../clash.js';
import { sameId, statusOf, isRegistered } from './data.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

const pad = n => String(n).padStart(2, '0');
const utc = d => Date.parse(`${d}T00:00:00Z`);
const iso = t => new Date(t).toISOString().slice(0, 10);
const validDate = d => typeof d === 'string' && ISO.test(d) && !Number.isNaN(utc(d));

export const monthTitle = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;
export const firstOfMonth = (year, month) => `${year}-${pad(month)}-01`;

export function addMonths(year, month, delta) {
  const i = year * 12 + (month - 1) + delta;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

// Monday of the week containing d.
export function weekStart(d) {
  const t = utc(d);
  return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS);
}

// 42 dates (six Monday-first weeks) covering the month.
export function monthCells(year, month) {
  const start = utc(weekStart(firstOfMonth(year, month)));
  return Array.from({ length: 42 }, (_, i) => iso(start + i * DAY_MS));
}

const SHOWN = new Set(['watching', 'entering']);
export const onCalendar = (decisions, c) => SHOWN.has(statusOf(decisions, c)) || isRegistered(decisions, c);

// Colour class: registered (green) wins, then entering (accent), else watching (soft).
export function toneOf(decisions, c) {
  if (isRegistered(decisions, c)) return 'reg';
  return statusOf(decisions, c) === 'entering' ? 'ent' : 'wat';
}
const TONE_LABEL = { reg: 'Registered', ent: 'Entering', wat: 'Watching' };
export const statusLabel = (decisions, c) => TONE_LABEL[toneOf(decisions, c)];

// One event per ⏰ registration close and per 🏁 competition end (only when it
// differs from the close), for items that are watching, entering or registered.
export function calendarEvents(records, decisions) {
  const out = [];
  for (const c of Array.isArray(records) ? records : []) {
    if (!c || !onCalendar(decisions, c)) continue;
    const base = { id: c.id, title: c.title, host: c.host, tone: toneOf(decisions, c), status: statusLabel(decisions, c), c };
    if (validDate(c.regn_close)) out.push({ ...base, date: c.regn_close, kind: 'close' });
    if (validDate(c.comp_end) && c.comp_end !== c.regn_close) out.push({ ...base, date: c.comp_end, kind: 'end' });
  }
  return out.sort((a, b) => (a.date === b.date ? String(a.title ?? '').localeCompare(String(b.title ?? '')) : a.date < b.date ? -1 : 1));
}

export function eventsByDay(records, decisions) {
  const m = new Map();
  for (const e of calendarEvents(records, decisions)) {
    if (!m.has(e.date)) m.set(e.date, []);
    m.get(e.date).push(e);
  }
  return m;
}

const datesOf = c => [c.regn_close, c.comp_end].filter(validDate);
const live = (c, today) => {
  const last = [c.comp_end, c.regn_close].find(validDate);
  return !!last && dayDiff(today, last) >= 0;
};

// Days on which a committed item has a date within the clash window of
// another committed item, both still live (same rule as clash.js). Returns
// { days: Set<date>, pairs: Map<date, [{ id, title, otherId, other, apart }]> }
// where apart is the nearest gap in days to the other item's dates.
export function clashDays(committed, today) {
  const items = (Array.isArray(committed) ? committed : []).filter(c => c && live(c, today));
  const pairs = new Map();
  for (const c of items) {
    for (const d of new Set(datesOf(c))) {
      for (const e of items) {
        if (e === c || sameId(e.id, c.id)) continue;
        const gaps = datesOf(e).map(x => Math.abs(dayDiff(d, x)));
        if (!gaps.length) continue;
        const apart = Math.min(...gaps);
        if (apart > WINDOW_DAYS) continue;
        if (!pairs.has(d)) pairs.set(d, []);
        const list = pairs.get(d);
        const seen = list.find(p => sameId(p.id, c.id) && sameId(p.otherId, e.id));
        if (seen) seen.apart = Math.min(seen.apart, apart);
        else list.push({ id: c.id, title: c.title, otherId: e.id, other: e.title, apart });
      }
    }
  }
  return { days: new Set(pairs.keys()), pairs };
}

const shortDate = (d, today) => {
  const [y, m, day] = d.split('-').map(Number);
  return `${day} ${MONTHS[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ''}`;
};

// Events from today onward in Monday-first weeks: [{ week, label, events }].
export function agendaGroups(events, today) {
  const thisWeek = weekStart(today);
  const nextWeek = iso(utc(thisWeek) + 7 * DAY_MS);
  const groups = new Map();
  for (const e of [...(events || [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (!validDate(e.date) || e.date < today) continue;
    const w = weekStart(e.date);
    if (!groups.has(w)) {
      const label = w === thisWeek ? 'This week' : w === nextWeek ? 'Next week' : `Week of ${shortDate(w, today)}`;
      groups.set(w, { week: w, label, events: [] });
    }
    groups.get(w).events.push(e);
  }
  return [...groups.values()];
}

const directlyEnterable = c => c.intl?.who_applies === 'team' && c.intl?.indian_ug === 'yes';
const months = a => (Array.isArray(a) ? a.filter(m => Number.isInteger(m) && m >= 1 && m <= 12) : []);

// §9.10: curated items with no confirmed dates that the team has marked
// (status other than skipped, or registered) or can enter directly, and that
// have at least one known month.
export function expectedItems(records, decisions) {
  return (Array.isArray(records) ? records : []).filter(c => {
    if (!c || c.source !== 'curated' || validDate(c.regn_close) || validDate(c.comp_end)) return false;
    if (!months(c.expected?.application_months).length && !months(c.expected?.finals_months).length) return false;
    const st = statusOf(decisions, c);
    if (st === 'skipped' && !isRegistered(decisions, c)) return false;
    return onCalendar(decisions, c) || directlyEnterable(c);
  });
}

// Dashed markers on the 1st of the displayed month. tone is the status colour
// when the item is marked, else 'exp'.
export function expectedMarkers(records, decisions, year, month) {
  const date = firstOfMonth(year, month);
  const out = [];
  for (const c of expectedItems(records, decisions)) {
    const tone = onCalendar(decisions, c) ? toneOf(decisions, c) : 'exp';
    const base = { date, id: c.id, title: c.title, tone, c };
    if (months(c.expected?.application_months).includes(month)) out.push({ ...base, kind: 'applications', label: `Applications usually open: ${c.title}` });
    if (months(c.expected?.finals_months).includes(month)) out.push({ ...base, kind: 'finals', label: `Finals usually: ${c.title}` });
  }
  return out;
}
