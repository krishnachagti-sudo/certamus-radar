// The only links the board accepts by hand: unstop.com, path ending -<digits>.
export function unstopId(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'unstop.com' && u.hostname !== 'www.unstop.com') return null;
  const m = u.pathname.replace(/\/+$/, '').match(/-(\d+)$/);
  return m ? Number(m[1]) : null;
}
