/** Ordering and stepping for Previous/Next Note inside one diff. No vscode import. */

export interface NavNote {
  id: string;
  side: 'old' | 'new';
  /** 1-based first line, on the note's own side. */
  startLine: number;
}

export interface NavCursor {
  side: 'old' | 'new';
  /** 1-based. */
  line: number;
}

/** Sort key: by line across both sides; on the same line the old side comes first. */
const key = (n: { side: 'old' | 'new'; startLine?: number; line?: number }): number => (n.startLine ?? n.line ?? 0) * 2 + (n.side === 'new' ? 1 : 0);

export function orderNotes<T extends NavNote>(notes: T[]): T[] {
  return [...notes].sort((a, b) => key(a) - key(b) || a.id.localeCompare(b.id));
}

/**
 * Note to go to from `cursor` (undefined = no position known): the next note after it,
 * or the previous one before it. Wraps at the ends. `wrapped` is true when it did.
 */
export function pickNote<T extends NavNote>(notes: T[], cursor: NavCursor | undefined, dir: 1 | -1): { note?: T; wrapped: boolean } {
  const ordered = orderNotes(notes);
  if (!ordered.length) {
    return { wrapped: false };
  }
  if (!cursor) {
    return { note: dir === 1 ? ordered[0] : ordered[ordered.length - 1], wrapped: false };
  }
  const ck = key(cursor);
  if (dir === 1) {
    const n = ordered.find(x => key(x) > ck);
    return n ? { note: n, wrapped: false } : { note: ordered[0], wrapped: true };
  }
  const before = ordered.filter(x => key(x) < ck);
  return before.length ? { note: before[before.length - 1], wrapped: false } : { note: ordered[ordered.length - 1], wrapped: true };
}
