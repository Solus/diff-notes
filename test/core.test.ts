import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodeQuery, encodeQuery, gitRefFor, parseGitdirPointer } from '../src/core/diffRef';
import { GitStatus, LOG_FORMAT, mergeWorkingChanges, parseLog, parseNameStatusZ } from '../src/core/gitParse';
import { rangeLabel, WORKING_TREE } from '../src/core/model';
import { extractSnippet, splitLines } from '../src/core/snippet';
import { CommentStore, NewComment } from '../src/core/store';

const sample: NewComment = {
  author: 'me',
  body: 'fix this',
  file: 'src/a.ts',
  side: 'new',
  startLine: 2,
  endLine: 3,
  snippet: { before: ['a'], lines: ['b', 'c'], after: ['d'] },
  origin: WORKING_TREE,
};

function newStore(): CommentStore {
  let n = 0;
  return new CommentStore(() => `id${++n}`, () => '2026-01-01T00:00:00.000Z');
}

test('store: add, reply, edit, resolve, reopen', () => {
  const s = newStore();
  const c = s.add(sample);
  assert.equal(c.status, 'open');
  const r = s.reply(c.id, 'me', 'later');
  s.edit(c.id, 'fix this now');
  s.edit(r.id, 'much later');
  s.setStatus(c.id, 'resolved');
  const got = s.get(c.id)!;
  assert.equal(got.body, 'fix this now');
  assert.equal(got.replies[0].body, 'much later');
  assert.equal(got.status, 'resolved');
  s.setStatus(c.id, 'open');
  assert.equal(s.get(c.id)!.status, 'open');
  assert.throws(() => s.edit('nope', 'x'));
});

test('store: serialize round-trips with schema version', () => {
  const s = newStore();
  s.add(sample);
  const text = s.serialize();
  assert.equal(JSON.parse(text).version, 1);
  const t = newStore();
  t.load(text);
  assert.deepEqual(t.all(), s.all());
  t.load(undefined);
  assert.equal(t.all().length, 0);
});

test('store: rejects unknown version', () => {
  assert.throws(() => CommentStore.parse('{"version":2,"comments":[]}'), /version/);
  assert.throws(() => CommentStore.parse('not json'));
});

test('snippet: lines plus clamped context', () => {
  const lines = splitLines('1\r\n2\n3\n4\n5\n6\n7\n8');
  assert.deepEqual(extractSnippet(lines, 4, 5), { before: ['1', '2', '3'], lines: ['4', '5'], after: ['6', '7', '8'] });
  assert.deepEqual(extractSnippet(lines, 1, 1), { before: [], lines: ['1'], after: ['2', '3', '4'] });
  assert.deepEqual(extractSnippet(lines, 8, 8), { before: ['5', '6', '7'], lines: ['8'], after: [] });
});

test('rangeLabel', () => {
  assert.equal(rangeLabel({ startLine: 22, endLine: 22, side: 'new' }), 'L22');
  assert.equal(rangeLabel({ startLine: 22, endLine: 25, side: 'new' }), 'L22–25');
  assert.equal(rangeLabel({ startLine: 3, endLine: 3, side: 'old' }), 'L3 (old)');
});

test('diffRef: query round-trip and refs', () => {
  const q = encodeQuery({ origin: 'abc', side: 'old' });
  assert.deepEqual(decodeQuery(q), { origin: 'abc', side: 'old' });
  assert.equal(decodeQuery('origin=abc&side=x'), undefined);
  assert.equal(gitRefFor({ origin: 'abc', side: 'old' }), 'abc^');
  assert.equal(gitRefFor({ origin: 'abc', side: 'new' }), 'abc');
  assert.equal(gitRefFor({ origin: WORKING_TREE, side: 'old' }), 'HEAD');
  assert.equal(gitRefFor({ origin: WORKING_TREE, side: 'new' }), undefined);
  assert.equal(parseGitdirPointer('gitdir: ../.git/worktrees/x\n'), '../.git/worktrees/x');
});

test('gitParse: log', () => {
  assert.ok(LOG_FORMAT.includes('%H'));
  const out = 'aaa\x1fa\x1fMe\x1f2026-01-01T00:00:00Z\x1ffirst\x1e\nbbb\x1fb\x1fMe\x1f2026-01-02T00:00:00Z\x1fsecond: with \x1e\n';
  const log = parseLog(out);
  assert.equal(log.length, 2);
  assert.deepEqual(log[0], { sha: 'aaa', shortSha: 'a', author: 'Me', date: '2026-01-01T00:00:00Z', subject: 'first' });
});

test('gitParse: name-status -z', () => {
  const out = ['M', 'src/a.ts', 'R087', 'old.ts', 'new.ts', 'A', 'b c.ts', 'D', 'gone.ts', ''].join('\0');
  assert.deepEqual(parseNameStatusZ(out), [
    { status: 'M', path: 'src/a.ts' },
    { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
    { status: 'A', path: 'b c.ts' },
    { status: 'D', path: 'gone.ts' },
  ]);
});

test('gitParse: merge index and working tree changes', () => {
  const files = mergeWorkingChanges(
    [
      { status: GitStatus.INDEX_ADDED, path: 'new.ts' },
      { status: GitStatus.INDEX_ADDED, path: 'tmp.ts' },
      { status: GitStatus.INDEX_RENAMED, path: 'b.ts', oldPath: 'a.ts' },
    ],
    [
      { status: GitStatus.MODIFIED, path: 'new.ts' },
      { status: GitStatus.DELETED, path: 'tmp.ts' },
      { status: GitStatus.UNTRACKED, path: 'u.ts' },
      { status: GitStatus.MODIFIED, path: 'm.ts' },
    ],
  );
  assert.deepEqual(files, [
    { status: 'R', path: 'b.ts', oldPath: 'a.ts' },
    { status: 'M', path: 'm.ts' },
    { status: 'A', path: 'new.ts' },
    { status: 'A', path: 'u.ts' },
  ]);
});
