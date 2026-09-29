// Monday digest to Krishna. buildDigest is pure; main() reads data/, sends
// with --send, and records what was announced.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { clashes } from '../clash.js';
import { dayDiff, todayIST } from '../dates.js';

const BOARD_URL = 'https://krishnachagti-sudo.github.io/certamus-radar/';
const TIER = { iit: 'IIT', iim: 'IIM', bschool: 'B-school', corporate: 'Corporate', other: 'Other' };
const STALE_HOURS = 36;
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function buildDigest({ competitions, decisions, status, state, now }) {
  const today = todayIST(now);
  const statusOf = c => decisions[c.id]?.status || 'undecided';
  const open = competitions.filter(c => !c.closed_on);
  // Pinned links were added by hand, so they count whatever their tier or format.
  const relevant = c => c.pinned || (c.tier !== 'other' && c.is_case !== false && c.verdict?.level !== 'out');
  const sent = state?.sent_ids ? new Set(state.sent_ids) : null;

  const fresh = open.filter(c => relevant(c) && statusOf(c) !== 'skipped'
    && (sent ? !sent.has(c.id) : dayDiff(c.first_seen, today) <= 7));
  const closing = open.filter(c => {
    if (!c.regn_close) return false;
    const d = dayDiff(today, c.regn_close);
    const st = statusOf(c);
    return d >= 0 && d <= 10 && (st === 'watching' || (st === 'undecided' && relevant(c) && c.verdict?.level === 'fits'));
  });
  const entering = competitions.filter(c => statusOf(c) === 'entering');
  const clashing = open
    .filter(c => statusOf(c) !== 'skipped' && (relevant(c) || statusOf(c) === 'entering'))
    .map(c => ({ c, with: clashes(c, entering, today) }))
    .filter(x => x.with.length);

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
  ].filter(([, rows]) => rows.length);

  const counts = `${fresh.length} new, ${closing.length} closing, ${clashing.length} clash${clashing.length === 1 ? '' : 'es'}`;
  const subject = `${stale ? '[stale data] ' : ''}Certamus Radar: ${blocks.length ? counts : 'nothing new this week'}`;
  const text = [staleLine, ...blocks.map(([h, rows]) => `${h}\n${rows.map(r => `- ${r}`).join('\n')}`),
    blocks.length ? null : 'Nothing new, nothing closing, no clashes.', `Board: ${BOARD_URL}`]
    .filter(Boolean).join('\n\n');
  const html = [staleLine && `<p style="color:#A1262B"><strong>${esc(staleLine)}</strong></p>`,
    ...blocks.map(([h, rows]) => `<h3>${esc(h)}</h3><ul>${rows.map(r => `<li>${esc(r)}</li>`).join('')}</ul>`),
    blocks.length ? null : '<p>Nothing new, nothing closing, no clashes.</p>',
    `<p><a href="${BOARD_URL}">Open the board</a></p>`].filter(Boolean).join('\n');

  return {
    subject, text, html,
    sections: { fresh, closing, clashing },
    nextState: { last_sent: now.toISOString(), sent_ids: competitions.map(c => c.id) },
  };
}

async function main() {
  const dir = new URL('../data/', import.meta.url);
  const read = (f, fallback) => {
    try { return JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')); } catch { return fallback; }
  };
  const d = buildDigest({
    competitions: read('competitions.json', []), decisions: read('decisions.json', {}),
    status: read('status.json', {}), state: read('digest-state.json', null), now: new Date(),
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
