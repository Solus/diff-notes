import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { relativeDate, rowDescription, tooltipMarkdown } from '../src/core/rowText';
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
  assert.equal(
    tooltipMarkdown(n, 'abc1234 subj', now),
    [
      '**src/a.ts · L5–7**\n\n*commit `abc1234 subj` · Open*',
      '**me** · 1 day ago\n\nfirst\nmore',
      '**Replies**\n\n**bob**\n\nok',
      '```typescript\nlet a;\n```',
    ].join('\n\n---\n\n'),
  );
  assert.ok(tooltipMarkdown(n, 'Working tree', now).startsWith('**src/a.ts · L5–7**\n\n*Working tree · Open*'));
  assert.ok(!tooltipMarkdown({ ...n, replies: [] }, 'x', now).includes('Replies'));
  const long = tooltipMarkdown({ ...n, snippet: { before: [], after: [], lines: Array.from({ length: 15 }, (_, i) => 'l' + i) } }, 'x', now);
  assert.ok(long.includes('l11\n```\n\n… 3 more lines') && !long.includes('l12'));
});
