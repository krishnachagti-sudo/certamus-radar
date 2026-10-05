import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusSelector } from '../lib/focus.js';

test('focusSelector: a data-focus key wins and is escaped', () => {
  assert.equal(focusSelector({ dataset: { focus: 'round-done:a"b' } }), '[data-focus="round-done:a\\"b"]');
  assert.equal(focusSelector({ dataset: { reg: '7' } }), '[data-reg="7"]');
  assert.equal(focusSelector({ dataset: {}, id: 'x' }), '#x');
  assert.equal(focusSelector(null), null);
});
