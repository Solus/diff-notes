/** Filtering, ordering, grouping and counting for the Comments list. No vscode import. */
import { StoredComment, WORKING_TREE } from './model';

/** Key of the Outdated group. */
export const OUTDATED_KEY = 'outdated';
/** Key of the PUSHED group. */
export const PUSHED_KEY = 'pushed';

export type GroupMode = 'commit' | 'file' | 'none';

export interface CommentGroup {
  /** Working tree, a commit, a file, or the PUSHED / Outdated group. */
  kind: 'worktree' | 'commit' | 'file' | 'pushed' | 'outdated';
  /** Commit SHA, `working-tree`, or file path. */
  key: string;
  comments: StoredComment[];
}

export function filterComments(all: readonly StoredComment[], openOnly: boolean): StoredComment[] {
  return openOnly ? all.filter(c => c.status === 'open') : [...all];
}

/** Open comments on the working tree or on unpushed commits (the status bar number). Outdated ones are not counted. */
export function countOpenUnpushed(all: readonly StoredComment[], unpushedShas: readonly string[]): number {
  const unpushed = new Set(unpushedShas);
  return all.filter(c => c.status === 'open' && !c.outdated && (c.origin === WORKING_TREE || unpushed.has(c.origin))).length;
}

/** Rank of an origin in the Commits list: working tree first, then unpushed commits in order, then the rest. */
function originRank(origin: string, order: readonly string[]): number {
  if (origin === WORKING_TREE) {
    return -1;
  }
  const i = order.indexOf(origin);
  return i === -1 ? order.length : i;
}

/** On a commit that is no longer in the unpushed list (and not outdated). */
export function isPushed(c: StoredComment, unpushedShas: readonly string[]): boolean {
  return !c.outdated && c.origin !== WORKING_TREE && !unpushedShas.includes(c.origin);
}

/** Commit-list order, then file, then line. */
export function sortComments(comments: readonly StoredComment[], order: readonly string[]): StoredComment[] {
  return [...comments].sort(
    (a, b) =>
      originRank(a.origin, order) - originRank(b.origin, order) ||
      a.origin.localeCompare(b.origin) ||
      a.file.localeCompare(b.file) ||
      a.startLine - b.startLine ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/**
 * Groups for the chosen mode. `order` = unpushed commit SHAs, newest first (the Commits list order).
 * Comments on pushed commits form a PUSHED group and outdated ones an Outdated group
 * (in that order, last), in every mode. Mode `none` returns only those groups: use
 * `sortComments` on the rest for the flat list.
 */
export function groupComments(comments: readonly StoredComment[], mode: GroupMode, order: readonly string[]): CommentGroup[] {
  const outdated = comments.filter(c => c.outdated);
  const pushed = comments.filter(c => isPushed(c, order));
  const sorted = sortComments(comments.filter(c => !c.outdated && !isPushed(c, order)), order);
  const groups: CommentGroup[] = [];
  const tail = (): CommentGroup[] => [
    ...groups,
    ...(pushed.length ? [{ kind: 'pushed' as const, key: PUSHED_KEY, comments: sortComments(pushed, order) }] : []),
    ...(outdated.length ? [{ kind: 'outdated' as const, key: OUTDATED_KEY, comments: sortComments(outdated, order) }] : []),
  ];
  if (mode === 'none') {
    return tail();
  }
  const sortedForFile = mode === 'file' ? [...sorted].sort((a, b) => a.file.localeCompare(b.file) || originRank(a.origin, order) - originRank(b.origin, order) || a.startLine - b.startLine) : sorted;
  for (const c of sortedForFile) {
    const key = mode === 'file' ? c.file : c.origin;
    let g = groups.find(x => x.key === key);
    if (!g) {
      const kind: CommentGroup['kind'] =
        mode === 'file' ? 'file' : c.origin === WORKING_TREE ? 'worktree' : 'commit';
      g = { kind, key, comments: [] };
      groups.push(g);
    }
    g.comments.push(c);
  }
  return tail();
}

/** What the Comments list shows: loose notes (mode `none`, shown before the groups) and the groups. */
export function visibleList(all: readonly StoredComment[], openOnly: boolean, mode: GroupMode, order: readonly string[]): { loose: StoredComment[]; groups: CommentGroup[] } {
  const comments = filterComments(all, openOnly);
  const loose = mode === 'none' ? sortComments(comments.filter(c => !c.outdated && !isPushed(c, order)), order) : [];
  return { loose, groups: groupComments(comments, mode, order) };
}
