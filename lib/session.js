// Edit-mode plumbing shared by every page: reading team decisions from the
// store, the stale-data / error / not-configured banners, and the footer.
import { configured, readDecisions } from './store.js';
import { esc } from './card.js';

export const istTime = iso => (iso ? new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'never');
export const NOT_CONFIGURED = 'Editing not configured yet';

// Reads are public, so every visitor sees the live decisions. overlay()
// re-applies saves still in flight; readMore() loads any other table the page
// needs. Not configured: read-only with no decisions. A failed read keeps the
// page up with an error banner.
export async function loadDecisions(state, { overlay = d => d, readMore = async () => {} } = {}) {
  state.decisions = {};
  if (!configured()) return;
  try {
    state.decisions = overlay(await readDecisions());
    await readMore();
  } catch (e) {
    state.error = `Could not load team data: ${e.message}`;
  }
}

export function bannersHtml(status, error, notice) {
  const s = status || {};
  const ageHours = s.last_ok ? (Date.now() - Date.parse(s.last_ok)) / 3.6e6 : Infinity;
  const out = [];
  if (s.last_error || ageHours > 36) {
    const m = `Data stale since ${istTime(s.last_ok)}${s.last_error ? `: ${s.last_error}` : ''}`;
    out.push(`<p class="banner" role="status">${esc(m)}</p>`);
  }
  if (notice) out.push(`<p class="banner" role="alert">${esc(notice)}</p>`);
  if (error) out.push(`<p class="banner" role="alert">${esc(error)}</p>`);
  if (!configured()) out.push(`<p class="banner quiet" role="status">${esc(NOT_CONFIGURED)}</p>`);
  return out.join('');
}

export const editFooterHtml = (editable, lastOk) => `<footer>
      ${editable ? '<button type="button" class="ghost" id="lock">Stop editing on this device</button>' : ''}
      <span>Updated ${esc(istTime(lastOk))}</span>
    </footer>`;
