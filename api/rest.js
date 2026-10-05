// PostgREST-lite: the only tables, columns and functions the API exposes,
// and the parameterised SQL for each request. Pure: no database, no HTTP.
// Identifiers in the SQL come only from these whitelists (and are quoted);
// every value is a bind parameter. Which rows a caller sees or may change
// is decided by Postgres (RLS and grants in db/schema.sql), not here; this
// only narrows what can be asked.

export const MAX_LIMIT = 1000;
export const MAX_ROWS_PER_WRITE = 1000;

// ops: the HTTP methods the browser pages or the jobs actually use.
export const TABLES = {
  members: { key: ['email'], columns: ['email', 'name', 'role', 'active'], ops: ['GET'] },
  listings: { key: ['section', 'id'], columns: ['section', 'id', 'regn_close', 'comp_end', 'closed_on', 'data', 'updated_at'], json: ['data'], ops: ['GET'] },
  archive: { key: ['section', 'archive_key'], columns: ['section', 'archive_key', 'data', 'archived_on'], json: ['data'], ops: ['GET'] },
  source_status: { key: ['section'], columns: ['section', 'data', 'updated_at'], json: ['data'], ops: ['GET'] },
  watch: { key: ['id'], columns: ['id', 'data', 'updated_at'], json: ['data'], ops: ['GET', 'POST'] },
  decisions: { key: ['id'], columns: ['id', 'status', 'registered', 'note', 'updated_at'], ops: ['GET', 'POST', 'DELETE'] },
  intl_dates: { key: ['id'], columns: ['id', 'regn_close', 'comp_end', 'confirmed_on'], ops: ['GET', 'POST', 'DELETE'] },
  manual: { key: ['id'], columns: ['id', 'url', 'added'], ops: ['GET', 'POST'] },
  teams: { key: ['listing_id'], columns: ['listing_id', 'section', 'invite_url', 'note', 'created_at'], ops: ['GET'] },
  team_members: { key: ['listing_id', 'email'], columns: ['listing_id', 'email', 'joined_at'], ops: ['GET'] },
  rounds: { key: ['id'], columns: ['id', 'listing_id', 'name', 'due', 'owner_email', 'done', 'done_at'], ops: ['GET'] },
};

// Named arguments with their Postgres types (in declaration order), and
// what comes back: 'void' -> null, 'scalar' -> the value, 'set' -> rows.
export const RPCS = {
  create_team: { args: { p_listing_id: 'text', p_section: 'text', p_invite_url: 'text', p_emails: 'text[]' }, returns: 'void' },
  update_team: { args: { p_listing_id: 'text', p_invite_url: 'text', p_emails: 'text[]' }, returns: 'void' },
  delete_team: { args: { p_listing_id: 'text' }, returns: 'void' },
  mark_joined: { args: { p_listing_id: 'text', p_joined: 'boolean' }, returns: 'void' },
  upsert_round: { args: { p_id: 'uuid', p_listing_id: 'text', p_name: 'text', p_due: 'date', p_owner_email: 'text' }, returns: 'scalar' },
  delete_round: { args: { p_id: 'uuid' }, returns: 'void' },
  set_round_done: { args: { p_id: 'uuid', p_done: 'boolean' }, returns: 'void' },
  my_joins: { args: {}, returns: 'set' },
  sync_section: { args: { p_section: 'text', p_rows: 'jsonb', p_archive: 'jsonb', p_status: 'jsonb' }, returns: 'scalar' },
  set_status: { args: { p_section: 'text', p_status: 'jsonb' }, returns: 'void' },
};

export class BadRequest extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const has = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);
const q = ident => `"${ident}"`; // only ever whitelisted identifiers

export function tableFor(name, method) {
  if (!has(TABLES, name)) throw new BadRequest(`unknown table ${name}`, 404, 'not_found');
  const t = TABLES[name];
  if (!t.ops.includes(method)) throw new BadRequest(`${method} is not allowed on ${name}`, 405, 'method_not_allowed');
  return t;
}

const column = (t, name, table) => {
  if (!t.columns.includes(name)) throw new BadRequest(`unknown column ${table}.${name}`);
  return name;
};

// `col=eq.value` parameters -> [[col, value]]. Only eq is supported.
function filters(t, table, params, reserved) {
  const out = [];
  for (const [k, v] of params) {
    if (reserved.has(k)) continue;
    column(t, k, table);
    if (!v.startsWith('eq.')) throw new BadRequest(`only eq. filters are supported (${k})`);
    out.push([k, v.slice(3)]);
  }
  return out;
}

const whereSql = (fs, values) => (fs.length
  ? ` where ${fs.map(([c, v]) => { values.push(v); return `${q(c)} = $${values.length}`; }).join(' and ')}`
  : '');

const nonNegInt = (v, what) => {
  if (v == null) return null;
  if (!/^\d{1,9}$/.test(v)) throw new BadRequest(`${what} must be a non-negative integer`);
  return Number(v);
};

// GET /db/<table>?select=a,b&col=eq.v&order=a.asc,b.desc&offset=0&limit=1000
// Each row comes back as one json value built by Postgres, so dates and
// timestamps read exactly as PostgREST wrote them ("2026-10-30").
export function selectSql(table, params) {
  const t = tableFor(table, 'GET');
  const sel = params.get('select');
  const cols = !sel || sel.trim() === '*'
    ? t.columns
    : [...new Set(sel.split(',').map(s => column(t, s.trim(), table)))];
  const values = [];
  const where = whereSql(filters(t, table, params, new Set(['select', 'order', 'offset', 'limit'])), values);
  const order = (params.get('order') || '').split(',').filter(Boolean).map(o => {
    const [c, dir = 'asc', ...rest] = o.trim().split('.');
    if (rest.length || !['asc', 'desc'].includes(dir)) throw new BadRequest(`bad order ${o}`);
    return `${q(column(t, c, table))} ${dir}`;
  });
  const limit = Math.min(nonNegInt(params.get('limit'), 'limit') ?? MAX_LIMIT, MAX_LIMIT);
  const offset = nonNegInt(params.get('offset'), 'offset') ?? 0;
  values.push(limit, offset);
  const obj = cols.map(c => `'${c}', ${q(c)}`).join(', ');
  return {
    sql: `select json_build_object(${obj}) as r from public.${q(table)}${where}`
      + `${order.length ? ` order by ${order.join(', ')}` : ''} limit $${values.length - 1} offset $${values.length}`,
    values,
  };
}

// POST /db/<table>[?ignore_duplicates=true], body: a row or an array of rows.
// An upsert on the table's primary key: the columns sent are inserted, and on
// a conflict the non-key columns sent are updated (or nothing is done).
export function upsertSql(table, params, body) {
  const t = tableFor(table, 'POST');
  for (const k of params.keys()) if (k !== 'ignore_duplicates') throw new BadRequest(`unknown parameter ${k}`);
  const ignore = params.get('ignore_duplicates');
  if (ignore != null && !['true', 'false'].includes(ignore)) throw new BadRequest('ignore_duplicates must be true or false');
  const rows = Array.isArray(body) ? body : [body];
  if (!rows.length) throw new BadRequest('no rows');
  if (rows.length > MAX_ROWS_PER_WRITE) throw new BadRequest(`at most ${MAX_ROWS_PER_WRITE} rows per request`);
  const cols = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new BadRequest('each row must be an object');
    for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(column(t, k, table));
  }
  for (const k of t.key) {
    if (rows.some(r => r[k] == null)) throw new BadRequest(`every row needs ${k}`);
  }
  const json = new Set(t.json || []);
  const values = [];
  const tuples = rows.map(r => `(${cols.map(c => {
    if (!has(r, c)) return 'default';
    const v = r[c];
    if (json.has(c)) { values.push(v == null ? null : JSON.stringify(v)); return `$${values.length}::jsonb`; }
    if (v != null && typeof v === 'object') throw new BadRequest(`${table}.${c} must be a plain value`);
    values.push(v);
    return `$${values.length}`;
  }).join(', ')})`);
  const rest = cols.filter(c => !t.key.includes(c));
  const action = ignore === 'true' || !rest.length
    ? 'do nothing'
    : `do update set ${rest.map(c => `${q(c)} = excluded.${q(c)}`).join(', ')}`;
  return {
    sql: `insert into public.${q(table)} (${cols.map(q).join(', ')}) values ${tuples.join(', ')}`
      + ` on conflict (${t.key.map(q).join(', ')}) ${action}`,
    values,
  };
}

// DELETE /db/<table>?col=eq.v (at least one filter: never a whole table).
export function deleteSql(table, params) {
  const t = tableFor(table, 'DELETE');
  const fs = filters(t, table, params, new Set());
  if (!fs.length) throw new BadRequest('a delete needs a filter');
  const values = [];
  return { sql: `delete from public.${q(table)}${whereSql(fs, values)}`, values };
}

const ARG = {
  text: v => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined),
  uuid: v => (typeof v === 'string' ? v : undefined),
  date: v => (typeof v === 'string' ? v : undefined),
  boolean: v => (typeof v === 'boolean' ? v : undefined),
  'text[]': v => (Array.isArray(v) && v.every(e => typeof e === 'string') ? v : undefined),
  jsonb: v => JSON.stringify(v),
};

// POST /rpc/<fn> with named arguments; a missing argument is null.
export function rpcSql(name, body) {
  if (!has(RPCS, name)) throw new BadRequest(`unknown function ${name}`, 404, 'not_found');
  const { args, returns } = RPCS[name];
  const given = body == null ? {} : body;
  if (typeof given !== 'object' || Array.isArray(given)) throw new BadRequest('arguments must be an object');
  for (const k of Object.keys(given)) if (!has(args, k)) throw new BadRequest(`unknown argument ${k} for ${name}`);
  const values = [];
  const list = Object.entries(args).map(([k, type]) => {
    const v = given[k];
    if (v == null) values.push(null);
    else {
      const ok = ARG[type](v);
      if (ok === undefined) throw new BadRequest(`${k} must be ${type}`);
      values.push(ok);
    }
    return `${k} => $${values.length}::${type}`;
  }).join(', ');
  const call = `public.${q(name)}(${list})`;
  const sql = returns === 'set' ? `select to_json(f) as r from ${call} f`
    : returns === 'scalar' ? `select to_json(${call}) as r`
      : `select ${call}`;
  return { sql, values, returns };
}
