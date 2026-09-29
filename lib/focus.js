// Focus survives a re-render: remember what identifies the focused control,
// then find its replacement. Selector values are escaped for CSS.
export const cssq = v => (globalThis.CSS?.escape ? CSS.escape(String(v)) : String(v).replace(/["\\]/g, '\\$&'));

export function focusSelector(el) {
  if (!el || !el.dataset) return null;
  const d = el.dataset;
  if (d.toggle !== undefined) return `[data-toggle="${cssq(d.toggle)}"][data-key="${cssq(d.key)}"]`;
  if (d.flag !== undefined) return `[data-flag="${cssq(d.flag)}"]`;
  if (d.set !== undefined) return `[data-set="${cssq(d.set)}"][data-id="${cssq(d.id)}"]`;
  if (d.note !== undefined) return `[data-note="${cssq(d.note)}"]`;
  if (d.reg !== undefined) return `[data-reg="${cssq(d.reg)}"]`;
  if (el.id) return `#${cssq(el.id)}`;
  return null;
}

export function refocus(sel, fallback) {
  const el = (sel && document.querySelector(sel)) || fallback;
  if (el && typeof el.focus === 'function') el.focus();
}

const TEXT_TYPES = new Set(['text', 'search', 'url', '']);
const isTextInput = el => el?.tagName === 'INPUT' && TEXT_TYPES.has(el.type || '');

// Call before replacing the DOM; call .restore() after. A text input being
// typed in (note, search) keeps its value and caret.
export function captureFocus() {
  const active = document.activeElement;
  const sel = focusSelector(active);
  const typing = isTextInput(active)
    ? { value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
  return {
    sel,
    restore(fallback) {
      refocus(sel, fallback);
      if (typing && sel) {
        const input = document.querySelector(sel);
        if (input) { input.value = typing.value; try { input.setSelectionRange(typing.start, typing.end); } catch { /* ignore */ } }
      }
    },
  };
}
