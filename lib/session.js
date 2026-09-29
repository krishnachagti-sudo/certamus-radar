// Edit-mode plumbing shared by every page that edits: reading decisions
// (live from the API with a token, else the published copy), the stale-data
// and error banners, and the token prompt.
import { pagesJson } from './data.js';
import { AuthError, apiRead, getToken, setToken } from './gh.js';
import { esc } from './card.js';

export const istTime = iso => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'never');

// Pages lags ~1 minute behind a commit; in edit mode read the live files.
// readMore() runs inside the same try for any other live file the page needs.
// A 401 calls tokenRejected(); any other error falls back to the published
// decisions and sets state.error.
export async function loadDecisions(state, tokenRejected, readMore = async () => {}) {
  if (!getToken()) {
    state.decisions = await pagesJson('decisions.json', {});
    return;
  }
  try {
    state.decisions = (await apiRead('data/decisions.json')).data;
    await readMore();
  } catch (e) {
    if (e instanceof AuthError) await tokenRejected();
    else {
      state.error = `${e.message}. Check the token.`;
      state.decisions = await pagesJson('decisions.json', {});
    }
  }
}

export function bannersHtml(status, error) {
  const s = status || {};
  const ageHours = s.last_ok ? (Date.now() - Date.parse(s.last_ok)) / 3.6e6 : Infinity;
  const out = [];
  if (s.last_error || ageHours > 36) {
    const m = `Data stale since ${istTime(s.last_ok)}${s.last_error ? `: ${s.last_error}` : ''}`;
    out.push(`<p class="banner" role="status">${esc(m)}</p>`);
  }
  if (error) out.push(`<p class="banner" role="alert">${esc(error)}</p>`);
  return out.join('');
}

// Returns true when a token was entered.
export function askToken() {
  const tok = prompt('Paste a fine-grained GitHub token (Contents: read and write, certamus-radar only). It stays in this browser.');
  if (!tok) return false;
  setToken(tok.trim());
  return true;
}

export const editFooterHtml = (editable, lastOk) => `<footer>
      ${editable ? '<button type="button" class="ghost" id="lock">Lock editing</button>' : '<button type="button" class="ghost" id="unlock">Edit</button>'}
      <span>Updated ${esc(istTime(lastOk))}</span>
    </footer>`;
