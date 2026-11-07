import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { findOpenLine } from '../src/core/openLine';

const snippet = { before: [], lines: ['const a = 1;', 'const b = 2;'], after: [] };

test('finds the moved snippet', () => {
  assert.deepEqual(findOpenLine(snippet, 1, 'x\ny\nz\nconst a = 1;\nconst b = 2;\n'), { line: 3, found: true });
});
test('falls back to stored line when not found', () => {
  assert.deepEqual(findOpenLine(snippet, 2, 'p\nq\nr\ns\n'), { line: 1, found: false });
});
test('fallback is clamped to file length', () => {
  assert.deepEqual(findOpenLine(snippet, 50, 'p\nq\nr'), { line: 2, found: false });
});
test('empty file falls back to line 0', () => {
  assert.deepEqual(findOpenLine(snippet, 9, ''), { line: 0, found: false });
});
