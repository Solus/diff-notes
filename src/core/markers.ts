/** Which lines of one diff document get a note marker. No vscode import. */
import { DiffSide } from './diffRef';
import { StoredComment } from './model';

/** 0-based inclusive line spans of open, live notes on this diff side. */
export function markerSpans(all: readonly StoredComment[], file: string, doc: DiffSide): Array<[number, number]> {
  return all
    .filter(c => c.status === 'open' && !c.outdated && c.file === file && c.origin === doc.origin && c.side === doc.side)
    .map(c => [c.startLine - 1, c.endLine - 1] as [number, number]);
}
