/** Which notes the cleanup actions delete, and the pushed-at bookkeeping. No vscode import. */
import { isPushed } from './commentList';
import { StoredComment, WORKING_TREE } from './model';

const DAY_MS = 24 * 60 * 60 * 1000;

export const resolvedNotes = (all: readonly StoredComment[]): StoredComment[] => all.filter(c => c.status === 'resolved');
export const outdatedNotes = (all: readonly StoredComment[]): StoredComment[] => all.filter(c => c.outdated);
export const pushedNotes = (all: readonly StoredComment[], unpushedShas: readonly string[]): StoredComment[] => all.filter(c => isPushed(c, unpushedShas));

/**
 * Record `pushedAt` the first time a note is seen as pushed; drop it when the note is back on the
 * working tree or an unpushed commit. Returns true if any note changed.
 */
export function stampPushed(all: readonly StoredComment[], unpushedShas: readonly string[], nowIso: string): boolean {
  let changed = false;
  for (const c of all) {
    if (isPushed(c, unpushedShas)) {
      if (!c.pushedAt) {
        c.pushedAt = nowIso;
        changed = true;
      }
    } else if (c.pushedAt && (c.origin === WORKING_TREE || unpushedShas.includes(c.origin))) {
      delete c.pushedAt;
      changed = true;
    }
  }
  return changed;
}

/** Pushed notes first seen as pushed more than `days` days ago. `days <= 0` = off. */
export function expiredPushed(all: readonly StoredComment[], unpushedShas: readonly string[], days: number, nowMs: number): StoredComment[] {
  if (!(days > 0)) {
    return [];
  }
  return pushedNotes(all, unpushedShas).filter(c => {
    const at = c.pushedAt ? Date.parse(c.pushedAt) : NaN;
    return !Number.isNaN(at) && nowMs - at > days * DAY_MS;
  });
}

/** "Delete 5 resolved notes?" */
export function deletePrompt(count: number, kind: string): string {
  return `Delete ${count} ${kind} note${count === 1 ? '' : 's'}?`;
}
