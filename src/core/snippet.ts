import { Snippet } from './model';

/** Lines of context stored above and below a commented range. */
export const SNIPPET_CONTEXT = 3;

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** Extract the commented lines (1-based, inclusive) plus surrounding context. */
export function extractSnippet(lines: string[], startLine: number, endLine: number, context = SNIPPET_CONTEXT): Snippet {
  const s = Math.max(1, Math.min(startLine, endLine));
  const e = Math.min(lines.length, Math.max(startLine, endLine));
  return {
    before: lines.slice(Math.max(0, s - 1 - context), s - 1),
    lines: lines.slice(s - 1, e),
    after: lines.slice(e, e + context),
  };
}
