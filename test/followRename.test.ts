import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { followRename } from '../src/core/followRename';
import { parseNameStatusZ } from '../src/core/gitParse';

const z = (...t: string[]) => t.join('\0') + '\0';

test('renamed file maps to its new path', () => {
  const ch = parseNameStatusZ(z('R100', 'src/utils.ts', 'src/helpers.ts', 'M', 'a.ts'));
  assert.deepEqual(followRename(ch, 'src/utils.ts'), { path: 'src/helpers.ts', deleted: false });
});
test('renamed and edited maps too', () => {
  const ch = parseNameStatusZ(z('R071', 'a.ts', 'b/c.ts'));
  assert.deepEqual(followRename(ch, 'a.ts'), { path: 'b/c.ts', deleted: false });
});
test('no rename keeps the path', () => {
  const ch = parseNameStatusZ(z('M', 'a.ts'));
  assert.deepEqual(followRename(ch, 'a.ts'), { path: 'a.ts', deleted: false });
  assert.deepEqual(followRename([], 'a.ts'), { path: 'a.ts', deleted: false });
});
test('deleted file is reported deleted', () => {
  const ch = parseNameStatusZ(z('D', 'a.ts'));
  assert.deepEqual(followRename(ch, 'a.ts'), { path: 'a.ts', deleted: true });
});
test('copy does not move the original', () => {
  const ch = parseNameStatusZ(z('C100', 'a.ts', 'copy.ts'));
  assert.deepEqual(followRename(ch, 'a.ts'), { path: 'a.ts', deleted: false });
});
