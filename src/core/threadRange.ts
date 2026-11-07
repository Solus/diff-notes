/** Column used as "end of line"; VS Code clamps positions past the line end. */
export const END_OF_LINE = 1 << 30;

/**
 * Stored 1-based lines for a thread range as VS Code reports it (0-based
 * lines, end exclusive-ish): a range ending at column 0 of a later line (a
 * full-line selection) does not include that line.
 */
export function linesFromRange(
  start: { line: number; character: number },
  end: { line: number; character: number },
): { startLine: number; endLine: number } {
  const startLine = start.line + 1;
  let endLine = end.line + 1;
  if (end.character === 0 && end.line > start.line) {
    endLine -= 1;
  }
  return { startLine, endLine };
}
