import { Snippet } from '../core/model';

/** Pure re-anchoring: stored snippet + new file text -> new range, or outdated. No `vscode` import. */

export type AnchorResult =
  | { status: 'anchored'; startLine: number; endLine: number }
  | { status: 'outdated' };

/** A window is accepted when strictly more than this fraction of the commented (non-blank) lines match. */
export const MATCH_THRESHOLD = 0.5;

const norm = (s: string): string => s.trim();

/**
 * Find where `snippet` now lives in `newLines`.
 * `oldStart` is the 1-based line it used to start at (used only to break ties).
 * The range keeps its original length; matching is positional within that window,
 * ignoring surrounding whitespace and blank lines.
 */
export function reanchor(snippet: Snippet, oldStart: number, newLines: string[]): AnchorResult {
  const n = snippet.lines.length;
  if (n === 0 || newLines.length < n) return { status: 'outdated' };

  const want = snippet.lines.map(norm);
  const nonBlank = want.filter((l) => l !== '').length;
  const before = snippet.before.map(norm);
  const after = snippet.after.map(norm);
  const have = newLines.map(norm);

  let best: { start: number; lines: number; ctx: number; dist: number } | undefined;
  for (let p = 0; p + n <= have.length; p++) {
    let lines = 0;
    for (let i = 0; i < n; i++) if (want[i] !== '' && want[i] === have[p + i]) lines++;
    if (lines === 0) continue;
    let ctx = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[before.length - 1 - i] !== '' && before[before.length - 1 - i] === have[p - 1 - i]) ctx++;
    }
    for (let i = 0; i < after.length; i++) {
      if (after[i] !== '' && after[i] === have[p + n + i]) ctx++;
    }
    const dist = Math.abs(p + 1 - oldStart);
    if (
      !best ||
      lines > best.lines ||
      (lines === best.lines && (ctx > best.ctx || (ctx === best.ctx && dist < best.dist)))
    ) {
      best = { start: p, lines, ctx, dist };
    }
  }

  if (!best || best.lines <= nonBlank * MATCH_THRESHOLD) return { status: 'outdated' };
  return { status: 'anchored', startLine: best.start + 1, endLine: best.start + n };
}
