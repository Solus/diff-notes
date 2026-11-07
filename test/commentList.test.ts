import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { countOpenUnpushed, filterComments, groupComments, sortComments } from '../src/core/commentList';
import { StoredComment, WORKING_TREE } from '../src/core/model';

let n = 0;
function mk(origin: string, file: string, startLine: number, status: 'open' | 'resolved' = 'open'): StoredComment {
  n++;
  return {
    id: `c${n}`, author: 'a', createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`, body: 'b', replies: [], status,
    file, side: 'new', startLine, endLine: startLine, snippet: { before: [], lines: [], after: [] }, origin,
  };
}

const order = ['new', 'old'];
const all = [mk('old', 'b.ts', 3), mk(WORKING_TREE, 'a.ts', 9), mk('new', 'b.ts', 1, 'resolved'), mk('gone', 'a.ts', 2), mk('new', 'a.ts', 5)];

test('open-only filter drops resolved', () => {
  assert.equal(filterComments(all, true).length, 4);
  assert.equal(filterComments(all, false).length, 5);
});

test('counter counts open comments on working tree and unpushed only', () => {
  assert.equal(countOpenUnpushed(all, order), 3);
  assert.equal(countOpenUnpushed(all, []), 1);
});

test('commit grouping: working tree, commits in list order, then PUSHED', () => {
  const g = groupComments(all, 'commit', order);
  assert.deepEqual(g.map(x => [x.kind, x.key, x.comments.length]), [
    ['worktree', WORKING_TREE, 1], ['commit', 'new', 2], ['commit', 'old', 1], ['pushed', 'pushed', 1],
  ]);
});

test('file grouping: by path, comments by commit order then line', () => {
  const g = groupComments(all, 'file', order);
  assert.deepEqual(g.map(x => [x.key, x.comments.length]), [['a.ts', 2], ['b.ts', 2], ['pushed', 1]]);
  assert.deepEqual(g[0].comments.map(c => c.origin), [WORKING_TREE, 'new']);
});

test('none: no groups, flat list in commit order', () => {
  assert.deepEqual(groupComments(all, 'none', order).map(x => x.kind), ['pushed']);
  assert.deepEqual(sortComments(all, order).map(c => c.origin), [WORKING_TREE, 'new', 'new', 'old', 'gone']);
});

test('pushed group comes before outdated, in every mode', () => {
  const out = { ...mk('old', 'a.ts', 1), outdated: true };
  for (const mode of ['commit', 'file', 'none'] as const) {
    assert.deepEqual(groupComments([...all, out], mode, order).slice(-2).map(x => x.kind), ['pushed', 'outdated']);
  }
});

test('file mode splits PUSHED and Outdated into per-file sub-groups; other modes do not', () => {
  const out = { ...mk('x', 'z.ts', 1), outdated: true };
  const list = [mk('gone', 'b.ts', 4), mk('gone', 'a.ts', 9), mk('gone', 'b.ts', 2), out];
  const g = groupComments(list, 'file', order);
  assert.deepEqual(g.map(x => [x.kind, x.files?.map(f => [f.key, f.comments.length])]), [
    ['pushed', [['a.ts', 1], ['b.ts', 2]]], ['outdated', [['z.ts', 1]]],
  ]);
  assert.equal(g[0].comments.length, 3);
  for (const mode of ['commit', 'none'] as const) {
    assert.ok(groupComments(list, mode, order).every(x => x.files === undefined));
  }
});
