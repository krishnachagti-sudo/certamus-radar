import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipsHtml, formatChipHtml, tierChipHtml } from '../lib/card.js';

const ctx = { decisions: {}, editable: false };
const c = over => ({ id: 1, title: 'T', host: 'H', tier: 'iim', verdict: { level: 'fits' }, ...over });

test('format chip: "Business event" for business, nothing for case or older records', () => {
  assert.match(formatChipHtml(c({ format_kind: 'business' })), /Business event/);
  assert.equal(formatChipHtml(c({ format_kind: 'case' })), '');
  assert.equal(formatChipHtml(c({})), '');
  assert.match(chipsHtml(c({ format_kind: 'business' }), 'undecided', ctx), /Business event/);
  assert.doesNotMatch(chipsHtml(c({ format_kind: 'case' }), 'undecided', ctx), /Business event/);
});

test('tier chip labels the national tier', () => {
  assert.match(tierChipHtml(c({ tier: 'national' })), /NIT \/ IIIT \/ national institutes/);
});
