import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { orderNotes, pickNote } from '../src/core/noteNav';

const n = (id: string, side: 'old' | 'new', startLine: number) => ({ id, side, startLine });
const notes = [n('c', 'new', 20), n('a', 'old', 5), n('b', 'new', 5), n('d', 'old', 12)];

test('orders by line across sides, old first on ties', () => {
  assert.deepEqual(orderNotes(notes).map(x => x.id), ['a', 'b', 'd', 'c']);
});

test('next/previous from cursor, wrapping at the ends', () => {
  assert.deepEqual(pickNote(notes, { side: 'new', line: 5 }, 1), { note: n('d', 'old', 12), wrapped: false });
  assert.equal(pickNote(notes, { side: 'new', line: 20 }, 1).note?.id, 'a');
  assert.equal(pickNote(notes, { side: 'new', line: 20 }, 1).wrapped, true);
  assert.equal(pickNote(notes, { side: 'old', line: 5 }, -1).note?.id, 'c');
  assert.equal(pickNote(notes, { side: 'old', line: 5 }, -1).wrapped, true);
  assert.equal(pickNote(notes, { side: 'old', line: 13 }, -1).note?.id, 'd');
});

test('no cursor starts at the ends; no notes gives nothing', () => {
  assert.equal(pickNote(notes, undefined, 1).note?.id, 'a');
  assert.equal(pickNote(notes, undefined, -1).note?.id, 'c');
  assert.equal(pickNote([], undefined, 1).note, undefined);
});
