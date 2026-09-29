// Private edit link: https://…/certamus-radar/#key=<64 hex>. On any page load
// the key is moved from the URL into this browser's storage (so it never
// lingers in the address bar or history) and checked once with the server.
import { parseKeyHash } from './rows.js';
import { configured, setKey, clearKey, checkEditor } from './store.js';

export const INVALID_LINK = 'That edit link isn’t valid';

// Returns a banner message, or null.
export async function initEditor() {
  const { key, rest } = parseKeyHash(location.hash);
  if (!key) return null;
  setKey(key);
  try { history.replaceState(history.state, '', `${location.pathname}${location.search}${rest}`); } catch { /* ignore */ }
  if (!configured()) return null; // kept for when editing is set up
  try {
    if (await checkEditor(key)) return null;
    clearKey();
    return INVALID_LINK;
  } catch (e) {
    return `Could not check the edit link: ${e.message}`;
  }
}
