import { Side, WORKING_TREE } from './model';

/** URI scheme of the read-only diff documents comments attach to. */
export const SCHEME = 'diff-notes';

/** URI scheme of the read-only outdated-snippet documents. */
export const OUTDATED_SCHEME = 'diff-notes-outdated';

export interface DiffSide {
  origin: string;
  side: Side;
}

export function encodeQuery(d: DiffSide): string {
  return new URLSearchParams({ origin: d.origin, side: d.side }).toString();
}

export function decodeQuery(query: string): DiffSide | undefined {
  const p = new URLSearchParams(query);
  const origin = p.get('origin');
  const side = p.get('side');
  if (!origin || (side !== 'old' && side !== 'new')) {
    return undefined;
  }
  return { origin, side };
}

/**
 * Git ref whose tree holds this side's content, or `undefined` for the
 * working tree on disk. A commit's old side is its first parent.
 */
export function gitRefFor(d: DiffSide): string | undefined {
  if (d.origin === WORKING_TREE) {
    return d.side === 'old' ? 'HEAD' : undefined;
  }
  return d.side === 'old' ? `${d.origin}^` : d.origin;
}

/** Read a `.git` file's `gitdir: <path>` pointer (linked worktrees, submodules). */
export function parseGitdirPointer(content: string): string | undefined {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(content);
  return m?.[1];
}
