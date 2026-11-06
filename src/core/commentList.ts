/** Filtering, ordering, grouping and counting for the Comments list. No vscode import. */
import { StoredComment, WORKING_TREE } from './model';

/** Key of the Outdated group. */
export const OUTDATED_KEY = 'outdated';

export type GroupMode = 'commit' | 'file' | 'none';

export interface CommentGroup {
  /** Working tree, a commit, a commit not in the unpushed list, a file, or the Outdated group. */
  kind: 'worktree' | 'commit' | 'other' | 'file' | 'outdated';
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
 * Outdated comments always form their own last group, in every mode.
 * Mode `none` returns only that group: use `sortComments` on the rest for the flat list.
 */
export function groupComments(comments: readonly StoredComment[], mode: GroupMode, order: readonly string[]): CommentGroup[] {
  const outdated = comments.filter(c => c.outdated);
  const sorted = sortComments(comments.filter(c => !c.outdated), order);
  const groups: CommentGroup[] = [];
  const tail = (): CommentGroup[] => (outdated.length ? [...groups, { kind: 'outdated', key: OUTDATED_KEY, comments: sortComments(outdated, order) }] : groups);
  if (mode === 'none') {
    return tail();
  }
  const sortedForFile = mode === 'file' ? [...sorted].sort((a, b) => a.file.localeCompare(b.file) || originRank(a.origin, order) - originRank(b.origin, order) || a.startLine - b.startLine) : sorted;
  for (const c of sortedForFile) {
    const key = mode === 'file' ? c.file : c.origin;
    let g = groups.find(x => x.key === key);
    if (!g) {
      const kind: CommentGroup['kind'] =
        mode === 'file' ? 'file' : c.origin === WORKING_TREE ? 'worktree' : order.includes(c.origin) ? 'commit' : 'other';
      g = { kind, key, comments: [] };
      groups.push(g);
    }
    g.comments.push(c);
  }
  return tail();
}
