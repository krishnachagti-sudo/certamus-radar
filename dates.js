// Every date comparison in Radar is a calendar date in IST, so the 7-day and
// 10-day boundaries do not move with the hour a job happens to run.
const IST_OFFSET_MS = 330 * 60 * 1000;

export function istDate(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// b - a, in days, for two 'YYYY-MM-DD' strings.
export function dayDiff(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function todayIST(now = new Date()) {
  return istDate(now.toISOString());
}
