// Copy an invite link from its read-only field: the clipboard API first;
// when that is blocked (http, an old browser, a denied permission) the text
// is selected so Ctrl+C / long-press copy works. Either way a polite live
// region says what happened.
function announce(text) {
  let live = document.getElementById('copy-live');
  if (!live) {
    live = document.createElement('p');
    live.id = 'copy-live';
    live.className = 'sr';
    live.setAttribute('role', 'status');
    document.body.appendChild(live);
  }
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

export async function copyFromField(button) {
  const input = document.getElementById(button?.dataset?.copy || '');
  if (!input) return;
  const label = button.textContent;
  const flash = text => {
    button.textContent = text;
    setTimeout(() => { if (button.isConnected) button.textContent = label; }, 2000);
  };
  try {
    if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
    await navigator.clipboard.writeText(input.value);
    flash('Copied');
    announce('Invite link copied');
  } catch {
    input.focus();
    input.select();
    try { input.setSelectionRange(0, input.value.length); } catch { /* ignore */ }
    flash('Selected');
    announce('Copy blocked: the link is selected, press Ctrl+C or Command+C');
  }
}
