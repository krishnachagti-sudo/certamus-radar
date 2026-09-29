import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOppDesk } from '../fetch/oppdesk.js';

const p = id => ({ id, link: `https://opportunitydesk.org/p/${id}/`, title: { rendered: 'T' }, content: { rendered: '' }, date: '2026-09-01T00:00:00' });
const page = (start, n) => Array.from({ length: n }, (_, i) => p(start + i));

test('requests category 11, 120 days back, 50 per page, limited fields', async () => {
  const urls = [];
  let pauses = 0;
  const posts = await fetchOppDesk({ getJson: async u => { urls.push(u); return page(1, 3); }, pause: async () => { pauses++; }, today: '2026-09-29' });
  assert.equal(posts.length, 3);
  assert.equal(urls.length, 1);
  const u = new URL(urls[0]);
  assert.equal(u.origin + u.pathname, 'https://opportunitydesk.org/wp-json/wp/v2/posts');
  assert.equal(u.searchParams.get('categories'), '11');
  assert.equal(u.searchParams.get('after'), '2026-06-01T00:00:00');
  assert.equal(u.searchParams.get('per_page'), '50');
  assert.equal(u.searchParams.get('_fields'), 'id,link,title,content,date');
  assert.equal(u.searchParams.get('page'), '1');
  assert.equal(pauses, 1);
});

test('pages while full, at most 3 pages', async () => {
  const urls = [];
  const posts = await fetchOppDesk({ getJson: async u => { urls.push(u); return page(urls.length * 100, 50); }, pause: async () => {}, today: '2026-09-29' });
  assert.equal(urls.length, 3);
  assert.equal(posts.length, 150);
});

test('stops on a short page', async () => {
  const urls = [];
  const posts = await fetchOppDesk({ getJson: async u => { urls.push(u); return urls.length === 1 ? page(1, 50) : page(100, 7); }, pause: async () => {}, today: '2026-09-29' });
  assert.equal(urls.length, 2);
  assert.equal(posts.length, 57);
});

test('an HTTP 400 past page 1 ends paging (WordPress: page out of range)', async () => {
  let n = 0;
  const posts = await fetchOppDesk({ getJson: async () => { n++; if (n === 2) throw new Error('HTTP 400 for x'); return page(1, 50); }, pause: async () => {}, today: '2026-09-29' });
  assert.equal(posts.length, 50);
});

test('a failure on page 1 or a non-array body throws', async () => {
  await assert.rejects(fetchOppDesk({ getJson: async () => { throw new Error('HTTP 503 for x'); }, pause: async () => {}, today: '2026-09-29' }), /503/);
  await assert.rejects(fetchOppDesk({ getJson: async () => ({ code: 'x' }), pause: async () => {}, today: '2026-09-29' }), /shape/);
});
