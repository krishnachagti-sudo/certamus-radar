// Pure aggregation for the Hosts & archive page (§2, §9.12). Browser-safe:
// imports only relative modules, never touches the DOM.

const TIER_ORDER = ['iit', 'iim', 'national', 'bschool', 'corporate', 'international', 'other'];
const tierRank = t => { const i = TIER_ORDER.indexOf(t); return i < 0 ? TIER_ORDER.length : i; };

const normHost = h => String(h ?? '').trim().replace(/\s+/g, ' ');
const normKey = h => normHost(h).toLowerCase();
const validMonth = m => Number.isInteger(m) && m >= 1 && m <= 12;

const monthOfDate = d => {
  const m = typeof d === 'string' ? /^\d{4}-(\d{2})-\d{2}$/.exec(d) : null;
  return m ? Number(m[1]) : null;
};

function addToRow(rows, host, tier, title, id, dateKey, months) {
  const h = normHost(host);
  if (!h) return;
  const key = normKey(h);
  if (!rows.has(key)) rows.set(key, { host: h, tier: tier || 'other', count: 0, months: new Set(), latestTitle: null, latestId: null, latestKey: '' });
  const row = rows.get(key);
  if ((!row.tier || row.tier === 'other') && tier && tier !== 'other') row.tier = tier;
  row.count += 1;
  for (const m of months) if (validMonth(m)) row.months.add(m);
  const sortKey = dateKey || '';
  if (row.latestTitle === null || sortKey > row.latestKey) {
    row.latestKey = sortKey;
    row.latestTitle = title;
    row.latestId = id;
  }
}

// hostRows(live, archive, curated): one row per host, deduped across the
// three sources (host names normalised on case/whitespace for the dedupe
// key, but the display spelling of the first-seen occurrence is kept).
// `live` and `archive` records supply months from regn_close, falling back
// to first_seen; `curated` (the raw data/international.json rows) supplies
// months from finals_months and is tagged tier 'international'. Unverified
// curated rows (`verified: false`) are skipped. Default sort: tier order
// (iit, iim, national, bschool, corporate, international, other), then host name.
export function hostRows(live, archive, curated) {
  const rows = new Map();
  // Curated hosts arrive canonically through `curated` (with finals_months
  // and the verified filter); a curated record that has also been merged
  // into competitions.json or archive.json (format: 'curated') is skipped
  // here so it is not counted twice.
  for (const c of Array.isArray(live) ? live : []) {
    if (!c || c.format === 'curated') continue;
    const dateKey = c.regn_close || c.first_seen || '';
    addToRow(rows, c.host, c.tier, c.title, c.id, dateKey, [monthOfDate(dateKey)]);
  }
  for (const a of Array.isArray(archive) ? archive : []) {
    if (!a || a.format === 'curated') continue;
    const dateKey = a.regn_close || a.first_seen || '';
    addToRow(rows, a.host, a.tier, a.title, a.id, dateKey, [monthOfDate(dateKey)]);
  }
  for (const c of Array.isArray(curated) ? curated : []) {
    if (!c || c.verified === false) continue;
    addToRow(rows, c.host, 'international', c.name, c.id, '', Array.isArray(c.finals_months) ? c.finals_months : []);
  }
  return [...rows.values()]
    .map(r => ({ host: r.host, tier: r.tier, count: r.count, months: [...r.months].sort((a, b) => a - b), latestTitle: r.latestTitle, latestId: r.latestId }))
    .sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || a.host.localeCompare(b.host));
}

// The archive's slim field set (mirrors fetch/merge.js's ARCHIVE_FIELDS).
const ARCHIVE_FIELDS = ['id', 'title', 'host', 'tier', 'url', 'regn_close', 'comp_end', 'first_seen', 'closed_on', 'format', 'is_case', 'source'];

// Same keying rule as fetch/merge.js's archiveKey: a record's own
// archive_key wins; otherwise a curated edition keys by id@regn_close so
// each edition archives separately, and everything else keys by bare id.
const keyOf = r => r?.archive_key || (r?.source === 'curated' && r?.regn_close ? `${r.id}@${r.regn_close}` : String(r?.id));

function slim(r) {
  const out = { archive_key: keyOf(r) };
  for (const k of ARCHIVE_FIELDS) out[k] = r?.[k] ?? null;
  return out;
}

// archiveList(live, archive): closed competitions, newest closed_on first.
// `archive` is data/archive.json (already slim, carries archive_key);
// `live` is competitions.json, filtered here to records with closed_on.
// Deduped by archive_key (falling back to id) so a record already archived
// and still lingering in the live file within its retention window is not
// duplicated; curated edition entries keep their archive_key.
export function archiveList(live, archive) {
  const have = new Map();
  for (const a of Array.isArray(archive) ? archive : []) {
    if (!a) continue;
    have.set(keyOf(a), slim(a));
  }
  for (const c of Array.isArray(live) ? live : []) {
    if (!c || !c.closed_on) continue;
    const key = keyOf(c);
    if (!have.has(key)) have.set(key, slim(c));
  }
  return [...have.values()].sort((a, b) => {
    if (a.closed_on === b.closed_on) return String(a.title ?? '').localeCompare(String(b.title ?? ''));
    if (!a.closed_on) return 1;
    if (!b.closed_on) return -1;
    return a.closed_on < b.closed_on ? 1 : -1;
  });
}
