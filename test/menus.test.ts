import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';

/** Commands with an icon that are wired up outside menus (TreeItem / status bar). Keep empty unless needed. */
const NON_MENU_ALLOW: string[] = [];

test('every command with an icon is shown in a menu (not just the palette)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const used = new Set<string>();
  for (const [menu, items] of Object.entries<any[]>(pkg.contributes.menus)) {
    if (menu !== 'commandPalette') {
      items.forEach(i => i.command && used.add(i.command));
    }
  }
  const missing = pkg.contributes.commands
    .filter((c: any) => c.icon && !used.has(c.command) && !NON_MENU_ALLOW.includes(c.command))
    .map((c: any) => c.command);
  assert.deepEqual(missing, []);
});
