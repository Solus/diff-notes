import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { StoredComment } from '../src/core/model';
import { markerSpans } from '../src/core/markers';

function mk(p: Partial<StoredComment>): StoredComment {
  return { id: 'x', author: 'a', createdAt: '', body: 'b', replies: [], status: 'open', file: 'a.ts', side: 'new', startLine: 2, endLine: 4,
    snippet: { before: [], lines: [], after: [] }, origin: 'sha', ...p };
}

test('markers: open live notes on the same file, origin and side only', () => {
  const all = [mk({}), mk({ status: 'resolved' }), mk({ outdated: true }), mk({ file: 'b.ts' }), mk({ origin: 'other' }), mk({ side: 'old', startLine: 7, endLine: 7 })];
  assert.deepEqual(markerSpans(all, 'a.ts', { origin: 'sha', side: 'new' }), [[1, 3]]);
  assert.deepEqual(markerSpans(all, 'a.ts', { origin: 'sha', side: 'old' }), [[6, 6]]);
});
