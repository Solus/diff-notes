import { ChangedFile } from './gitParse';

/**
 * Where does `file` live now? `changes` is `git diff -M --name-status <base>` against the working tree,
 * where `file` is the path as it was at `base`. Lookup only; no I/O.
 */
export function followRename(changes: ChangedFile[], file: string): { path: string; deleted: boolean } {
  const renamed = changes.find(c => c.status === 'R' && c.oldPath === file);
  if (renamed) {
    return { path: renamed.path, deleted: false };
  }
  return { path: file, deleted: changes.some(c => c.status === 'D' && c.path === file) };
}
