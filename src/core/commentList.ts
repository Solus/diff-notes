/** Filtering, ordering, grouping and counting for the Comments list. No vscode import. */
import { StoredComment, WORKING_TREE } from './model';

/** Key of the Outdated group. */
export const OUTDATED_KEY = 'outdated';
/** Key of the Pushed group. */
export const Pushed_KEY = 'pushed';

export type GroupMode = 'commit' | 'file' | 'none';

export interface CommentGroup {
  /** Working tree, a commit, a file, or the Pushed / Outdated group. */
  kind: 'worktree' | 'commit' | 'file' | 'pushed' | 'outdated';
  /** Commit SHA, `working-tree`, or file path. */
  key: string;
  comments: StoredComment[];
  /** Pushed / Outdated group in File mode: its notes split into per-file sub-groups, sorted by path. */
  files?: CommentGroup[];
}

export function filterComments(all: readonly StoredComment[], openOnly: boolean): StoredComment[] {
  return openOnly ? all.filter(c => c.status === 'open') : [...all];
}

/** Open comments on the working tree or on unpushed commits (the status bar number). Outdated ones are not counted. */
export function countOpenUnpushed(all: readonly StoredComment[], unpushedShas: readonly string[]): number {
  const unpushed = new Set(unpushedShas);
  return all.filter(c => c.status === 'open' && !c.outdated && (c.origin === WORKING_TREE || unpushed.has(c.origin))).length;
}

/** Open, non-outdated notes on one file of one commit / the working tree (either side). Drives the Commits file badge. */
export function countOpenInFile(all: readonly StoredComment[], origin: string, file: string): number {
  return all.filter(c => c.status === 'open' && !c.outdated && c.origin === origin && c.file === file).length;
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

/** Per-file groups, sorted by path; notes in a group by commit-list order, then line. */
export function splitByFile(comments: readonly StoredComment[], order: readonly string[]): CommentGroup[] {
  const out: CommentGroup[] = [];
  for (const c of [...comments].sort((a, b) => a.file.localeCompare(b.file) || originRank(a.origin, order) - originRank(b.origin, order) || a.startLine - b.startLine)) {
    let g = out[out.length - 1];
    if (!g || g.key !== c.file) {
      g = { kind: 'file', key: c.file, comments: [] };
      out.push(g);
    }
    g.comments.push(c);
  }
  return out;
}

/**
 * Groups for the chosen mode. `order` = unpushed commit SHAs, newest first (the Commits list order).
 * Comments on pushed commits form a Pushed group and outdated ones an Outdated group
 * (in that order, last), in every mode. Mode `none` returns only those groups: use
 * `sortComments` on the rest for the flat list.
 */
export function groupComments(comments: readonly StoredComment[], mode: GroupMode, order: readonly string[]): CommentGroup[] {
  const outdated = comments.filter(c => c.outdated);
  const pushed = comments.filter(c => isPushed(c, order));
  const sorted = sortComments(comments.filter(c => !c.outdated && !isPushed(c, order)), order);
  const groups: CommentGroup[] = [];
  const special = (kind: 'pushed' | 'outdated', key: string, list: StoredComment[]): CommentGroup[] => {
    if (!list.length) {
      return [];
    }
    const g: CommentGroup = { kind, key, comments: sortComments(list, order) };
    if (mode === 'file') {
      g.files = splitByFile(list, order);
    }
    return [g];
  };
  const tail = (): CommentGroup[] => [...groups, ...special('pushed', Pushed_KEY, pushed), ...special('outdated', OUTDATED_KEY, outdated)];
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
