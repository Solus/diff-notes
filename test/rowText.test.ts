import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { joinParts, noteCount, relativeDate, rowDescription, rowLabel, tooltipMarkdown } from '../src/core/rowText';
import { StoredComment } from '../src/core/model';

const c = { file: 'src/deep/a.ts', startLine: 5, endLine: 7, side: 'new' as const };

test('row description by grouping', () => {
  assert.equal(rowDescription('file', c, 'abc1234'), 'L5–7');
  assert.equal(rowDescription('commit', c, 'abc1234'), 'a.ts L5–7');
  assert.equal(rowDescription('worktree', c, 'Working tree'), 'a.ts L5–7');
  assert.equal(rowDescription(undefined, c, 'abc1234'), 'a.ts L5–7 · abc1234');
  assert.equal(rowDescription('nested', c, 'abc1234'), 'L5–7 · abc1234');
  assert.equal(rowDescription('pushed', c, 'abc1234'), 'a.ts L5–7 · abc1234');
  assert.equal(rowDescription('outdated', { ...c, endLine: 5 }, 'abc1234'), 'a.ts L5 · abc1234');
});

test('relative date', () => {
  const now = Date.parse('2026-01-10T00:00:00Z');
  assert.equal(relativeDate('2026-01-09T00:00:00Z', now), '1 day ago');
  assert.equal(relativeDate('2026-01-07T00:00:00Z', now), '3 days ago');
  assert.equal(relativeDate('2026-01-10T00:00:00Z', now), 'just now');
  assert.equal(relativeDate('nope', now), '');
});

test('tooltip markdown', () => {
  const n: StoredComment = {
    id: 'a', author: 'me', createdAt: '2026-01-09T00:00:00Z', body: 'first\nmore', replies: [{ id: 'r', author: 'bob', createdAt: 't', body: 'ok' }], status: 'open',
    file: 'src/a.ts', side: 'new', startLine: 5, endLine: 7, snippet: { before: [], lines: ['let a;'], after: [] }, origin: 'abc',
  };
  const now = Date.parse('2026-01-10T00:00:00Z');
  const M = (t: string): string => `<span style="color:var(--vscode-descriptionForeground);">${t}</span>`;
  assert.equal(
    tooltipMarkdown(n, 'abc1234 subj', now),
    [
      `$(file) **src/a.ts** · L5–7\n\n$(git-commit) abc1234 · subj · ${M('Open')}`,
      `$(comment) **me** · ${M('1 day ago')}\n\nfirst\nmore`,
      '> **bob** — ok',
      '```typescript\nlet a;\n```',
    ].join('\n\n---\n\n'),
  );
  assert.ok(tooltipMarkdown(n, 'Working tree', now).includes(`$(edit) Working tree · ${M('Open')}`));
  const two = tooltipMarkdown({ ...n, replies: [{ id: 'r', author: 'bob', createdAt: '2026-01-09T00:00:00Z', body: 'a\nb' }, { id: 's', author: 'al', createdAt: 't', body: 'c' }] }, 'x', now);
  assert.ok(two.includes(`> **bob** · ${M('1 day ago')} — a\n> b\n\n> **al** — c`));
  assert.ok(!two.includes('Replies'));
  const long = tooltipMarkdown({ ...n, snippet: { before: [], after: [], lines: Array.from({ length: 8 }, (_, i) => 'l' + i) } }, 'x', now);
  assert.ok(long.includes('l4\n```\n\n' + M('… 3 more lines')) && !long.includes('l5'));
  const evil = tooltipMarkdown({ ...n, author: '$(x)<b>', body: '<img src=x> $(bug)\n```\n<b> $(k)\n```' }, 'abc $(sub)', now);
  assert.ok(evil.includes('\\$(x)\\<b\\>') && evil.includes('\\<img src=x> \\$(bug)') && evil.includes('\n<b> $(k)\n') && evil.includes('abc · \\$(sub)'));
});

test('row label strips markdown', () => {
  assert.equal(rowLabel('**Fix** the `foo()` call'), 'Fix the foo() call');
  assert.equal(rowLabel('\n\n## Heading *x*'), 'Heading x');
  assert.equal(rowLabel('- [docs](http://x.y) and _more_'), 'docs and more');
  assert.equal(rowLabel('```ts\nlet a;\n```'), 'let a;');
  assert.equal(rowLabel('snake_case_name stays'), 'snake_case_name stays');
  assert.equal(rowLabel('  \n'), '(empty)');
});

test('note count and joined parts', () => {
  assert.equal(noteCount(0), '');
  assert.equal(noteCount(1), '1 note');
  assert.equal(noteCount(2), '2 notes');
  assert.equal(joinParts('src', noteCount(1)), 'src · 1 note');
  assert.equal(joinParts('', noteCount(0)), '');
});
