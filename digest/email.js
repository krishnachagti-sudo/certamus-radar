// Monday digest to Krishna. buildDigest is pure; main() reads data/, sends
// with --send, and records what was announced.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { clashes } from '../clash.js';
import { dayDiff, istDate, todayIST } from '../dates.js';
import { defaultConfig, readTables } from '../fetch/supabase.js';

const BOARD_URL = 'https://krishnachagti-sudo.github.io/certamus-radar/';
const TIER = { iit: 'IIT', iim: 'IIM', bschool: 'B-school', corporate: 'Corporate', international: 'International', other: 'Other' };
const REGISTERED_DAYS = 14;
const STALE_HOURS = 36;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthNames = ms => ms.map(m => MONTH_NAMES[m - 1]).filter(Boolean).join('/');
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Team decisions from Supabase; if that fails, the old data/decisions.json
// when present (readFallback() returns it or undefined), else none. Never
// throws: the digest still goes out, with a warning line at the top.
export async function loadDecisions(cfg, readFallback) {
  const { decisions: r } = await readTables(cfg, ['decisions']);
  if (r.value !== undefined) return { decisions: r.value, warning: null };
  const local = readFallback();
  const usable = local && typeof local === 'object' && !Array.isArray(local);
  return {
    decisions: usable ? local : {},
    warning: `Team decisions unavailable (${r.error})${usable ? '; using the last saved copy' : ''}. Statuses, Registered and clash checks below may be incomplete.`,
  };
}

export function buildDigest({ competitions, decisions, status, state, now, watch = {}, warnings = [] }) {
  const today = todayIST(now);
  const statusOf = c => decisions[c.id]?.status || 'undecided';
  const open = competitions.filter(c => !c.closed_on);
  // Pinned links were added by hand, so they count whatever their tier or format.
  const relevant = c => c.pinned || (c.tier !== 'other' && c.is_case !== false && c.verdict?.level !== 'out');
  const sent = state?.sent_ids ? new Set(state.sent_ids) : null;

  const registeredOf = c => decisions[c.id]?.registered === true;
  const committedOf = c => statusOf(c) === 'entering' || registeredOf(c);
  // Curated rows are standing entries, not new listings: they get their own section.
  const fresh = open.filter(c => c.source !== 'curated' && relevant(c) && statusOf(c) !== 'skipped'
    && (sent ? !sent.has(c.id) : dayDiff(c.first_seen, today) <= 7));
  const closing = open.filter(c => {
    if (!c.regn_close) return false;
    const d = dayDiff(today, c.regn_close);
    const st = statusOf(c);
    return d >= 0 && d <= 10 && (st === 'watching' || (st === 'undecided' && relevant(c) && c.verdict?.level === 'fits'));
  });
  const committed = competitions.filter(committedOf);
  const clashing = open
    .filter(c => statusOf(c) !== 'skipped' && (relevant(c) || committedOf(c)))
    .map(c => ({ c, with: clashes(c, committed, today) }))
    .filter(x => x.with.length);

  const closingIds = new Set(closing.map(c => String(c.id)));
  const registered = competitions.filter(c => registeredOf(c) && !closingIds.has(String(c.id))
    && [c.regn_close, c.comp_end].some(d => d && dayDiff(today, d) >= 0 && dayDiff(today, d) <= REGISTERED_DAYS));

  const month = Number(today.slice(5, 7));
  const months = [month, (month % 12) + 1];
  const direct = c => c.intl?.who_applies === 'team' && c.intl?.indian_ug === 'yes';
  const international = competitions
    .filter(c => c.source === 'curated' && c.is_case !== false && statusOf(c) !== 'skipped' && c.verdict?.level !== 'out'
      && (c.expected?.application_months || []).some(m => months.includes(m)))
    .sort((a, b) => Number(direct(b)) - Number(direct(a)));

  const lastSentDay = state?.last_sent ? istDate(state.last_sent) : null;
  const byId = new Map(competitions.map(c => [String(c.id), c]));
  const watchChanged = Object.entries(watch && typeof watch === 'object' ? watch : {})
    .filter(([id, w]) => byId.has(id) && w?.changed_on
      && (lastSentDay ? w.changed_on > lastSentDay : dayDiff(w.changed_on, today) <= 7))
    .map(([id, w]) => ({ id, c: byId.get(id), changed_on: w.changed_on }));

  const lastOk = status?.last_ok ? Date.parse(status.last_ok) : 0;
  const stale = Boolean(status?.last_error) || !lastOk || (now - lastOk) / 3.6e6 > STALE_HOURS;
  const staleLine = stale
    ? `Data is stale: last good fetch ${status?.last_ok || 'never'}${status?.last_error ? ` (${status.last_error})` : ''}.`
    : null;

  const line = c => `${c.title} (${TIER[c.tier] || c.tier}, ${c.host}), closes ${c.regn_close || 'n/a'}, ${c.verdict?.level}${c.verdict?.reasons?.length ? `: ${c.verdict.reasons.join('; ')}` : ''}`;
  const blocks = [
    ['New since last digest', fresh.map(line)],
    ['Closing within 10 days', closing.map(line)],
    ['Clashes', clashing.map(x => `${x.c.title} clashes with ${x.with.join(', ')}`)],
    ['Registered: coming up', registered.map(c => `${c.title} (${c.host}), closes ${c.regn_close || 'n/a'}, ends ${c.comp_end || 'n/a'}`)],
    ['International', [
      ...international.map(c => `${c.title} (${c.host}), applications usually ${monthNames(c.expected.application_months)}: ${direct(c) ? 'Your team applies' : c.verdict?.reasons?.[0] || 'check eligibility'}`),
      ...watchChanged.map(x => `${x.c.title}: Official page changed on ${x.changed_on}, new edition?`),
    ]],
  ].filter(([, rows]) => rows.length);

  const intlCount = international.length + watchChanged.length;
  const counts = [`${fresh.length} new`, `${closing.length} closing`, `${clashing.length} clash${clashing.length === 1 ? '' : 'es'}`,
    intlCount ? `${intlCount} international` : null, registered.length ? `${registered.length} registered` : null]
    .filter(Boolean).join(', ');
  const subject = `${stale ? '[stale data] ' : ''}Certamus Radar: ${blocks.length ? counts : 'nothing new this week'}`;
  const text = [...warnings, staleLine, ...blocks.map(([h, rows]) => `${h}\n${rows.map(r => `- ${r}`).join('\n')}`),
    blocks.length ? null : 'Nothing new, nothing closing, no clashes.', `Board: ${BOARD_URL}`]
    .filter(Boolean).join('\n\n');
  const html = [...warnings.map(w => `<p style="color:#A1262B"><strong>${esc(w)}</strong></p>`), staleLine && `<p style="color:#A1262B"><strong>${esc(staleLine)}</strong></p>`,
    ...blocks.map(([h, rows]) => `<h3>${esc(h)}</h3><ul>${rows.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`),
    blocks.length ? null : '<p>Nothing new, nothing closing, no clashes.</p>',
    `<p><a href="${BOARD_URL}">Open the board</a></p>`].filter(Boolean).join('\n');

  return {
    subject, text, html,
    sections: { fresh, closing, clashing, registered, international, watchChanged },
    nextState: { last_sent: now.toISOString(), sent_ids: competitions.map(c => c.id) },
  };
}

async function main() {
  const dir = new URL('../data/', import.meta.url);
  const read = (f, fallback) => {
    try { return JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')); } catch { return fallback; }
  };
  const { decisions, warning } = await loadDecisions(defaultConfig(), () => read('decisions.json', undefined));
  const d = buildDigest({
    competitions: read('competitions.json', []), decisions,
    status: read('status.json', {}), state: read('digest-state.json', null), now: new Date(),
    watch: read('watch.json', {}), warnings: warning ? [warning] : [],
  });
  if (!process.argv.includes('--send')) {
    console.log(`${d.subject}\n\n${d.text}`);
    return;
  }
  const { GMAIL_USER, GMAIL_APP_PASSWORD, DIGEST_TO } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set');
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  await transport.sendMail({ from: `Certamus Radar <${GMAIL_USER}>`, to: DIGEST_TO || GMAIL_USER, subject: d.subject, text: d.text, html: d.html });
  fs.writeFileSync(new URL('digest-state.json', dir), JSON.stringify(d.nextState, null, 2) + '\n');
  console.log(`sent: ${d.subject}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}
