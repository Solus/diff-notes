/** Stored data shapes for `.git/diff-notes/comments.json`. No vscode import. */

export type Side = 'old' | 'new';
export type Status = 'open' | 'resolved';

/** `origin` value for comments on uncommitted changes (diffed against HEAD). */
export const WORKING_TREE = 'working-tree';

export interface Snippet {
  /** Context lines directly above the commented range. */
  before: string[];
  /** The commented lines themselves (startLine..endLine). */
  lines: string[];
  /** Context lines directly below the commented range. */
  after: string[];
}

export interface Reply {
  id: string;
  author: string;
  createdAt: string;
  body: string;
  editedAt?: string;
}

export interface StoredComment {
  id: string;
  author: string;
  createdAt: string;
  body: string;
  editedAt?: string;
  replies: Reply[];
  status: Status;
  /** Repo-relative path (forward slashes) of the file on the commented side. */
  file: string;
  side: Side;
  /** 1-based, inclusive. */
  startLine: number;
  endLine: number;
  snippet: Snippet;
  /** Commit SHA, or `working-tree`. */
  origin: string;
  /** Set when the snippet can no longer be found; range/origin/snippet then describe the last known place. */
  outdated?: boolean;
  /** ISO time the commit was first seen as pushed (for auto-clear). */
  pushedAt?: string;
}

/** Where a comment lives now (result of re-anchoring). */
export type Anchor =
  | { outdated: false; origin: string; file: string; startLine: number; endLine: number; snippet: Snippet }
  | { outdated: true };

export const SCHEMA_VERSION = 1;

export interface NotesFile {
  version: typeof SCHEMA_VERSION;
  comments: StoredComment[];
}

/** Thread header label, e.g. `L22` or `L22–25`; the old (deleted) side is marked. */
export function rangeLabel(c: Pick<StoredComment, 'startLine' | 'endLine' | 'side'>): string {
  const lines = c.startLine === c.endLine ? `L${c.startLine}` : `L${c.startLine}–${c.endLine}`;
  return c.side === 'old' ? `${lines} (old)` : lines;
}
