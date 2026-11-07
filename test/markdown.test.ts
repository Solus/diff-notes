import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { countNotes, languageOf, noteToMarkdown, notesToMarkdown } from '../src/core/markdown';
import { visibleList } from '../src/core/commentList';
import { StoredComment, WORKING_TREE } from '../src/core/model';

const NO_CODE = { before: [], lines: [], after: [] };

function mk(id: string, extra: Partial<StoredComment> = {}): StoredComment {
  return {
    id, author: 'me', createdAt: '2026-01-01T00:00:00Z', body: 'first\nmore', replies: [{ id: 'r', author: 'bob', createdAt: 't', body: 'ok\nline2' }], status: 'open',
    file: 'src/a.ts', side: 'new', startLine: 5, endLine: 7, snippet: { before: [], lines: ['let a;', 'let b;'], after: [] }, origin: 'abc1234def', ...extra,
  };
}
const label = (o: string): string => (o === WORKING_TREE ? 'Working tree' : 'abc1234 subj');

test('note format: checklist, indented rest, replies, fenced snippet', () => {
  assert.equal(
    noteToMarkdown(mk('a'), label),
    ['- [ ] src/a.ts:L5-7 (abc1234 subj) — first', '  more', '  bob: ok', '  line2', '  ```typescript', '  let a;', '  let b;', '  ```'].join('\n'),
  );
});

test('resolved is checked, single line has no range, longer fence if code has backticks', () => {
  const out = noteToMarkdown(mk('a', { status: 'resolved', endLine: 5, body: 'x', replies: [], snippet: { before: [], lines: ['```'], after: [] }, file: 'x.unknown' }), label);
  assert.equal(out, ['- [x] x.unknown:L5 (abc1234 subj) — x', '  ````', '  ```', '  ````'].join('\n'));
});

test('sections: headings only when given; empty sections skipped; count', () => {
  const secs = [
    { notes: [mk('a', { replies: [], snippet: NO_CODE, body: 'one' })] },
    { heading: 'PUSHED', notes: [] },
    { heading: 'Working tree', notes: [mk('b', { origin: WORKING_TREE, replies: [], snippet: NO_CODE, body: 'two' })] },
  ];
  assert.equal(notesToMarkdown(secs, label), '- [ ] src/a.ts:L5-7 (abc1234 subj) — one\n\n## Working tree\n\n- [ ] src/a.ts:L5-7 (Working tree) — two\n');
  assert.equal(countNotes(secs), 2);
});

test('languageOf', () => {
  assert.equal(languageOf('a/b.TS'), 'typescript');
  assert.equal(languageOf('Dockerfile'), 'dockerfile');
  assert.equal(languageOf('x'), '');
});

test('visibleList follows filter and mode', () => {
  const all = [mk('o'), mk('r', { status: 'resolved' }), mk('p', { origin: 'pushed1' }), mk('d', { outdated: true })];
  const none = visibleList(all, true, 'none', ['abc1234def']);
  assert.deepEqual(none.loose.map(c => c.id), ['o']);
  assert.deepEqual(none.groups.map(g => g.kind), ['pushed', 'outdated']);
  assert.equal(visibleList(all, false, 'file', ['abc1234def']).groups[0].comments.length, 2);
});

test('subsections render as ### under the section heading', () => {
  const a = mk('a', { origin: WORKING_TREE, replies: [], snippet: NO_CODE, body: 'one' });
  const b = mk('b', { origin: WORKING_TREE, replies: [], snippet: NO_CODE, body: 'two', file: 'src/b.ts' });
  const secs = [{ heading: 'PUSHED', notes: [a, b], subsections: [{ heading: 'src/a.ts', notes: [a] }, { heading: 'src/b.ts', notes: [b] }] }];
  assert.equal(
    notesToMarkdown(secs, label),
    '## PUSHED\n\n### src/a.ts\n\n- [ ] src/a.ts:L5-7 (Working tree) — one\n\n### src/b.ts\n\n- [ ] src/b.ts:L5-7 (Working tree) — two\n',
  );
  assert.equal(countNotes(secs), 2);
});
