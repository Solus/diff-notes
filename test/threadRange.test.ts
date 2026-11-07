import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { linesFromRange } from '../src/core/threadRange';

test('range ending at col 0 of next line excludes that line', () => {
  assert.deepEqual(linesFromRange({ line: 2, character: 0 }, { line: 5, character: 0 }), { startLine: 3, endLine: 5 });
});
test('range ending mid-line includes that line', () => {
  assert.deepEqual(linesFromRange({ line: 2, character: 0 }, { line: 5, character: 4 }), { startLine: 3, endLine: 6 });
});
test('empty or single-line range at col 0 keeps its line', () => {
  assert.deepEqual(linesFromRange({ line: 2, character: 0 }, { line: 2, character: 0 }), { startLine: 3, endLine: 3 });
});
