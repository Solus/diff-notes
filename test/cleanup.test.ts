import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { deletePrompt, expiredPushed, outdatedNotes, pushedNotes, resolvedNotes, stampPushed } from '../src/core/cleanup';
import { StoredComment, WORKING_TREE } from '../src/core/model';
import { CommentStore } from '../src/core/store';

function mk(id: string, origin: string, extra: Partial<StoredComment> = {}): StoredComment {
  return {
    id, author: 'a', createdAt: '2026-01-01T00:00:00Z', body: 'b', replies: [], status: 'open',
    file: 'f.ts', side: 'new', startLine: 1, endLine: 1, snippet: { before: [], lines: [], after: [] }, origin, ...extra,
  };
}
const unpushed = ['u1'];
const all = [
  mk('wt', WORKING_TREE), mk('u', 'u1'), mk('p', 'p1'), mk('pr', 'p2', { status: 'resolved' }),
  mk('o', 'p3', { outdated: true }), mk('r', 'u1', { status: 'resolved' }),
];

test('selectors', () => {
  assert.deepEqual(resolvedNotes(all).map(c => c.id), ['pr', 'r']);
  assert.deepEqual(pushedNotes(all, unpushed).map(c => c.id), ['p', 'pr']);
  assert.deepEqual(outdatedNotes(all).map(c => c.id), ['o']);
});

test('stampPushed stamps once, leaves others, clears when unpushed again', () => {
  const list = [mk('p', 'p1'), mk('u', 'u1', { pushedAt: 'x' }), mk('o', 'p3', { outdated: true, pushedAt: 'keep' })];
  assert.equal(stampPushed(list, unpushed, 'T1'), true);
  assert.equal(list[0].pushedAt, 'T1');
  assert.equal(list[1].pushedAt, undefined);
  assert.equal(list[2].pushedAt, 'keep');
  assert.equal(stampPushed(list, unpushed, 'T2'), false);
  assert.equal(list[0].pushedAt, 'T1');
});

test('expiredPushed respects days, 0 = off, unstamped never expires', () => {
  const now = Date.parse('2026-02-01T00:00:00Z');
  const list = [mk('old', 'p1', { pushedAt: '2026-01-01T00:00:00Z' }), mk('new', 'p1', { pushedAt: '2026-01-30T00:00:00Z' }), mk('none', 'p1'), mk('un', 'u1', { pushedAt: '2025-01-01T00:00:00Z' })];
  assert.deepEqual(expiredPushed(list, unpushed, 7, now).map(c => c.id), ['old']);
  assert.deepEqual(expiredPushed(list, unpushed, 0, now), []);
});

test('deletePrompt pluralizes', () => {
  assert.equal(deletePrompt(5, 'resolved'), 'Delete 5 resolved notes?');
  assert.equal(deletePrompt(1, 'pushed'), 'Delete 1 pushed note?');
});

test('store remove and removeReply', () => {
  const s = new CommentStore();
  s.load(JSON.stringify({ version: 1, comments: [mk('a', 'x', { replies: [{ id: 'r1', author: 'a', createdAt: 't', body: 'b' }] }), mk('b', 'x')] }));
  assert.equal(s.removeReply('r1')?.id, 'a');
  assert.equal(s.get('a')?.replies.length, 0);
  assert.equal(s.removeReply('nope'), undefined);
  assert.equal(s.remove(['a', 'zzz']), 1);
  assert.deepEqual(s.all().map(c => c.id), ['b']);
});
