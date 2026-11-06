import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { AnchorEnv, resolveComment } from '../src/anchor/resolve';
import { groupComments, countOpenUnpushed } from '../src/core/commentList';
import { Side, StoredComment, WORKING_TREE } from '../src/core/model';
import { extractSnippet } from '../src/core/snippet';
import { CommentStore } from '../src/core/store';

const base = ['a0', 'a1', 'a2', 'a3', 'T1', 'T2', 'T3', 'b1', 'b2', 'b3'];

function mk(origin: string, side: Side = 'new'): StoredComment {
  return { id: 'c', author: 'a', createdAt: 'x', body: 'b', replies: [], status: 'open', file: 'f.ts', side, startLine: 5, endLine: 7, snippet: extractSnippet(base, 5, 7), origin };
}

function env(p: Partial<AnchorEnv> & { files?: Record<string, string[]> }): AnchorEnv {
  return {
    readSide: async (o) => (p.files?.[o] ?? []).join('\n'),
    workingTreeChanged: () => true,
    commitAlive: async () => true,
    rewriteCandidates: async () => [],
    landingCandidates: async () => [],
    commitTouches: async () => true,
    ...p,
  };
}

test('working tree comment follows moved code', async () => {
  const a = await resolveComment(mk(WORKING_TREE), env({ files: { [WORKING_TREE]: ['x', 'y', ...base] } }));
  assert.deepEqual(a.outdated === false && [a.origin, a.startLine, a.endLine], [WORKING_TREE, 7, 9]);
});

test('working tree comment becomes outdated when its lines change', async () => {
  const a = await resolveComment(mk(WORKING_TREE), env({ files: { [WORKING_TREE]: ['q', 'r', 's'] } }));
  assert.deepEqual(a, { outdated: true });
});

test('committed working tree comment moves to the commit it landed in', async () => {
  const e = env({ workingTreeChanged: () => false, landingCandidates: async () => ['new', 'old'], commitTouches: async (s) => s === 'old', files: { old: ['z', ...base], new: base } });
  const a = await resolveComment(mk(WORKING_TREE), e);
  assert.deepEqual(a.outdated === false && [a.origin, a.startLine], ['old', 6]);
});

test('working tree comment with discarded changes is outdated', async () => {
  const a = await resolveComment(mk(WORKING_TREE), env({ workingTreeChanged: () => false }));
  assert.deepEqual(a, { outdated: true });
});

test('commit comment stays put while the commit exists', async () => {
  const c = mk('abc');
  assert.deepEqual(await resolveComment(c, env({})), { outdated: false, origin: 'abc', startLine: 5, endLine: 7, snippet: c.snippet });
});

test('amended commit: comment moves to the rewritten commit', async () => {
  const e = env({ commitAlive: async () => false, rewriteCandidates: async () => ['new1'], files: { new1: ['top', ...base] } });
  const a = await resolveComment(mk('abc'), e);
  assert.deepEqual(a.outdated === false && [a.origin, a.startLine], ['new1', 6]);
});

test('rewritten commit that lost the code, or no candidate: outdated', async () => {
  const gone = env({ commitAlive: async () => false, rewriteCandidates: async () => ['n'], files: { n: ['x', 'y'] } });
  assert.deepEqual(await resolveComment(mk('abc'), gone), { outdated: true });
  assert.deepEqual(await resolveComment(mk('abc'), env({ commitAlive: async () => false })), { outdated: true });
});

test('store.setAnchor reports changes and clears outdated', () => {
  const s = new CommentStore();
  const c = s.add({ ...mk('abc'), id: undefined } as never);
  assert.equal(s.setAnchor(c.id, { outdated: true }), true);
  assert.equal(s.setAnchor(c.id, { outdated: true }), false);
  assert.equal(s.setAnchor(c.id, { outdated: false, origin: 'abc', startLine: 5, endLine: 7, snippet: c.snippet }), true);
  assert.equal(c.outdated, undefined);
  assert.equal(s.setAnchor(c.id, { outdated: false, origin: 'abc', startLine: 5, endLine: 7, snippet: c.snippet }), false);
});

test('outdated comments get their own last group in every mode and are not counted', () => {
  const a = mk('abc');
  const o = { ...mk('old'), id: 'o', outdated: true };
  for (const mode of ['commit', 'file'] as const) {
    const g = groupComments([o, a], mode, ['abc']);
    assert.deepEqual(g.map(x => x.kind), [mode === 'file' ? 'file' : 'commit', 'outdated']);
  }
  assert.deepEqual(groupComments([o, a], 'none', ['abc']).map(x => [x.kind, x.comments.length]), [['outdated', 1]]);
  assert.equal(countOpenUnpushed([o, a], ['abc', 'old']), 1);
});
