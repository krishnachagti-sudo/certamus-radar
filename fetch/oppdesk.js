// Opportunity Desk (WordPress REST, category 11 = competitions). Low volume
// and optional: run.js treats a failure here as a warning, not a failed run.
import { defaultGetJson, defaultPause } from './unstop.js';

const BASE = 'https://opportunitydesk.org/wp-json/wp/v2/posts';
const WINDOW_DAYS = 120;
const PER_PAGE = 50;
const MAX_PAGES = 3;

function afterIso(today) {
  const t = Date.parse(`${today}T00:00:00Z`) - WINDOW_DAYS * 86400000;
  return new Date(t).toISOString().slice(0, 19);
}

const pageUrl = (after, page) => {
  const q = new URLSearchParams({ categories: '11', after, per_page: String(PER_PAGE), _fields: 'id,link,title,content,date', page: String(page) });
  return `${BASE}?${q}`;
};

export async function fetchOppDesk({ getJson = defaultGetJson, pause = defaultPause, today }) {
  const after = afterIso(today);
  const posts = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    let body;
    try {
      body = await getJson(pageUrl(after, page));
    } catch (e) {
      // WordPress answers 400 for a page past the end.
      if (page > 1 && /HTTP 400\b/.test(e.message)) break;
      throw e;
    } finally {
      await pause();
    }
    if (!Array.isArray(body)) throw new Error('Opportunity Desk response shape changed');
    posts.push(...body);
    if (body.length < PER_PAGE) break;
  }
  return posts;
}
