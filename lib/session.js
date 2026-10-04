// Page plumbing shared by every page once a member is signed in: loading
// data with a banner on failure, the stale-data / error banners (the stale
// one reads the section's `source_status` row) and the footer.
import { esc } from './card.js';

export const istTime = iso => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'never');

// Runs a page's reads; a failure (network, expired session) keeps the page up
// with whatever it had and an error banner.
export async function guardLoad(state, read) {
  state.error = null;
  try {
    await read();
  } catch (e) {
    state.error = `Could not load data: ${e.message}`;
  }
}

// status null = not loaded (no stale banner on top of the load error).
export function bannersHtml(status, error) {
  const s = status || {};
  const ageHours = s.last_ok ? (Date.now() - Date.parse(s.last_ok)) / 3.6e6 : Infinity;
  const out = [];
  if (status != null && (s.last_error || ageHours > 36)) {
    const m = `Data stale since ${istTime(s.last_ok)}${s.last_error ? `: ${s.last_error}` : ''}`;
    out.push(`<p class="banner" role="status">${esc(m)}</p>`);
  }
  if (error) out.push(`<p class="banner" role="alert">${esc(error)}</p>`);
  return out.join('');
}

export const footerHtml = lastOk => `<footer><span>Updated ${esc(istTime(lastOk))}</span></footer>`;
