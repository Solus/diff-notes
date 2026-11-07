import { reanchor } from '../anchor';
import { Snippet } from './model';

export interface OpenLine {
  /** 0-based line to put the cursor on. */
  line: number;
  /** True when the note's code was found in the current text; false when the stored line was used. */
  found: boolean;
}

/** Line to open in the current file for a note: re-anchored via its snippet, else the stored line clamped to the file. No vscode import. */
export function findOpenLine(snippet: Snippet, storedLine: number, fileText: string): OpenLine {
  const lines = fileText.split(/\r?\n/);
  const r = reanchor(snippet, storedLine, lines);
  if (r.status === 'anchored') {
    return { line: r.startLine - 1, found: true };
  }
  return { line: Math.max(0, Math.min(storedLine, lines.length) - 1), found: false };
}
