/** Parsers for git CLI output and vscode.git change lists. No vscode import. */

export interface CommitInfo {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T';

export interface ChangedFile {
  status: FileStatus;
  /** Repo-relative path on the new side (forward slashes). */
  path: string;
  /** Repo-relative path on the old side, when it differs (renames/copies). */
  oldPath?: string;
}

/** `git log` format matching parseLog (unit/record separators). */
export const LOG_FORMAT = '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e';

const FIELD = String.fromCharCode(0x1f);
const RECORD = String.fromCharCode(0x1e);
const NUL = String.fromCharCode(0);

export function parseLog(out: string): CommitInfo[] {
  return out
    .split(RECORD)
    .map(r => r.trim())
    .filter(r => r.length > 0)
    .map(r => {
      const [sha, shortSha, author, date, subject] = r.split(FIELD);
      return { sha, shortSha, author, date, subject: subject ?? '' };
    });
}

/** Parse `git diff-tree --name-status -z` output (no commit id line). */
export function parseNameStatusZ(out: string): ChangedFile[] {
  const t = out.split(NUL).filter(x => x.length > 0);
  const files: ChangedFile[] = [];
  for (let i = 0; i < t.length; ) {
    const letter = t[i++][0];
    if (letter === 'R' || letter === 'C') {
      const oldPath = t[i++];
      const path = t[i++];
      files.push({ status: letter, path, oldPath });
    } else {
      const path = t[i++];
      const status: FileStatus = letter === 'A' || letter === 'D' || letter === 'T' ? letter : 'M';
      files.push({ status, path });
    }
  }
  return files;
}

/** Subset of vscode.git's Status enum values used here. */
export const GitStatus = {
  INDEX_MODIFIED: 0,
  INDEX_ADDED: 1,
  INDEX_DELETED: 2,
  INDEX_RENAMED: 3,
  INDEX_COPIED: 4,
  MODIFIED: 5,
  DELETED: 6,
  UNTRACKED: 7,
  INTENT_TO_ADD: 9,
  INTENT_TO_RENAME: 10,
  TYPE_CHANGED: 11,
} as const;

export interface RawChange {
  status: number;
  path: string;
  oldPath?: string;
}

function letterFor(status: number): FileStatus {
  switch (status) {
    case GitStatus.INDEX_ADDED:
    case GitStatus.UNTRACKED:
    case GitStatus.INTENT_TO_ADD:
      return 'A';
    case GitStatus.INDEX_DELETED:
    case GitStatus.DELETED:
      return 'D';
    case GitStatus.INDEX_RENAMED:
    case GitStatus.INTENT_TO_RENAME:
      return 'R';
    default:
      return 'M';
  }
}

function toFile(c: RawChange): ChangedFile {
  const status = letterFor(c.status);
  if (status === 'R') {
    return c.oldPath && c.oldPath !== c.path ? { status, path: c.path, oldPath: c.oldPath } : { status: 'M', path: c.path };
  }
  return { status, path: c.path };
}

/**
 * Combine index and working-tree changes into one HEAD ↔ working tree file list.
 * Index entries first, then working-tree entries layered on top.
 */
export function mergeWorkingChanges(index: RawChange[], workingTree: RawChange[]): ChangedFile[] {
  const byPath = new Map<string, ChangedFile>();
  for (const c of index) {
    byPath.set(c.path, toFile(c));
  }
  for (const c of workingTree) {
    const next = toFile(c);
    const prev = byPath.get(c.path);
    if (!prev) {
      byPath.set(c.path, next);
    } else if (next.status === 'D') {
      if (prev.status === 'A') {
        byPath.delete(c.path); // added then deleted: no change vs HEAD
      } else {
        byPath.set(c.path, { status: 'D', path: prev.oldPath ?? c.path });
      }
    }
    // A worktree modification on top of an index add/rename/modify keeps the index status.
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}
