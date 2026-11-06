import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { reanchor } from '../src/anchor';
import { extractSnippet } from '../src/core/snippet';

const original = ['a0', 'a1', 'a2', 'a3', 'TARGET1', 'TARGET2', 'TARGET3', 'b1', 'b2', 'b3', 'b4'];
const snip = extractSnippet(original, 5, 7);

test('unchanged text keeps the same range', () => {
  assert.deepEqual(reanchor(snip, 5, original), { status: 'anchored', startLine: 5, endLine: 7 });
});

test('moved code is followed to its new lines', () => {
  const moved = ['new1', 'new2', 'new3', ...original];
  assert.deepEqual(reanchor(snip, 5, moved), { status: 'anchored', startLine: 8, endLine: 10 });
});

test('moved code with a shifted-up position is followed', () => {
  const moved = original.slice(2);
  assert.deepEqual(reanchor(snip, 5, moved), { status: 'anchored', startLine: 3, endLine: 5 });
});

test('majority of lines still matching stays anchored', () => {
  const changed = original.map((l) => (l === 'TARGET2' ? 'EDITED' : l));
  assert.deepEqual(reanchor(snip, 5, changed), { status: 'anchored', startLine: 5, endLine: 7 });
});

test('minority of lines matching is outdated', () => {
  const changed = original.map((l) => (l === 'TARGET2' || l === 'TARGET3' ? 'EDITED' : l));
  assert.deepEqual(reanchor(snip, 5, changed), { status: 'outdated' });
});

test('removed code is outdated', () => {
  const removed = ['x', 'y', 'z'];
  assert.deepEqual(reanchor(snip, 5, removed), { status: 'outdated' });
});

test('empty file is outdated', () => {
  assert.deepEqual(reanchor(snip, 5, []), { status: 'outdated' });
});

test('duplicate text: context picks the right copy', () => {
  const dup = ['dup', 'dup', 'x1', 'dup', 'dup', 'x2'];
  const s = extractSnippet(dup, 4, 5);
  assert.deepEqual(reanchor(s, 4, ['q', 'q', ...dup]), { status: 'anchored', startLine: 6, endLine: 7 });
});

test('duplicate text with equal context: nearest to the old position wins', () => {
  const dup = ['same', 'other', 'same'];
  const s = extractSnippet(dup, 3, 3, 0);
  assert.deepEqual(reanchor(s, 3, dup), { status: 'anchored', startLine: 3, endLine: 3 });
  assert.deepEqual(reanchor(s, 1, dup), { status: 'anchored', startLine: 1, endLine: 1 });
});

test('whitespace-only differences still match', () => {
  const ws = original.map((l) => (l.startsWith('TARGET') ? `    ${l}  ` : l));
  assert.deepEqual(reanchor(snip, 5, ws), { status: 'anchored', startLine: 5, endLine: 7 });
});

test('blank lines alone do not count as a match', () => {
  const s = extractSnippet(['', 'KEEP', '', ''], 1, 3, 0);
  assert.deepEqual(reanchor(s, 1, ['', '', '', 'other']), { status: 'outdated' });
});
