// The only links the board accepts by hand: unstop.com, path ending -<digits>.
export function unstopId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'unstop.com' && u.hostname !== 'www.unstop.com') return null;
  const m = u.pathname.replace(/\/+$/, '').match(/-(\d+)$/);
  return m ? Number(m[1]) : null;
}

// Links from curated and Opportunity Desk sources: any https URL, nothing
// else (blocks javascript:, data:, plain http).
export function httpsUrl(url) {
  if (typeof url !== 'string') return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
