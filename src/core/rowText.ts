/** Text for Comments list rows. No vscode import. */
import { languageOf } from './markdown';
import { rangeLabel, StoredComment } from './model';

export type RowGroup = 'file' | 'commit' | 'worktree' | 'pushed' | 'outdated' | 'nested' | undefined;

const baseName = (file: string): string => file.slice(file.lastIndexOf('/') + 1);

/**
 * Row description by the group the note sits in (undefined = ungrouped list).
 * File group: `L5–7`. Commit/working-tree group: `a.ts L5–7`. Ungrouped: `a.ts L5–7 · abc1234`.
 * Under a file sub-heading inside Pushed/Outdated (`nested`): `L5–7 · abc1234`.
 * Pushed/Outdated groups are not the commit or file themselves, so they get file name and short sha.
 */
export function rowDescription(group: RowGroup, c: Pick<StoredComment, 'file' | 'startLine' | 'endLine' | 'side'>, shortSha: string): string {
  const range = rangeLabel(c);
  switch (group) {
    case 'file':
      return range;
    case 'nested':
      return `${range} · ${shortSha}`;
    case 'commit':
    case 'worktree':
      return `${baseName(c.file)} ${range}`;
    default:
      return `${baseName(c.file)} ${range} · ${shortSha}`;
  }
}

/** Short age like `3 days ago`; empty text for unparsable dates. */
export function relativeDate(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return '';
  }
  const s = Math.max(0, Math.round((now - t) / 1000));
  const units: [string, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, size] of units) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${name}${n === 1 ? '' : 's'} ago`;
    }
  }
  return 'just now';
}

/** Max snippet lines shown in a tooltip. */
const TIP_CODE_LINES = 5;
/** Max commit subject length in the tooltip header. */
const TIP_SUBJECT_MAX = 60;

/** Escape text for inline markdown with HTML and theme icons enabled (`$(name)` would draw an icon). */
export function escapeInline(t: string): string {
  return t.replace(/[\\`*_<>&|~[\]]/g, m => '\\' + m).replace(/\$\(/g, '\\$(');
}

/** Escape a markdown body for the same mode; fenced code blocks are left as they are. */
export function escapeBody(body: string): string {
  let fence = '';
  return body.split(/\r?\n/).map(line => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) {
        fence = m[1];
      } else if (m[1][0] === fence[0] && m[1].length >= fence.length) {
        fence = '';
      }
      return line;
    }
    return fence ? line : line.replace(/</g, '\\<').replace(/\$\(/g, '\\$(');
  }).join('\n');
}

/** Muted text (description colour). Needs `supportHtml`. */
const muted = (t: string): string => `<span style="color:var(--vscode-descriptionForeground);">${t}</span>`;

/** Muted version of an already escaped markdown body: each text line wrapped; fences, blank lines and list/quote/heading markers left alone. */
function mutedBody(escaped: string): string {
  let fence = '';
  return escaped.split('\n').map(line => {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) {
        fence = m[1];
      } else if (m[1][0] === fence[0] && m[1].length >= fence.length) {
        fence = '';
      }
      return line;
    }
    if (fence || !line.trim()) {
      return line;
    }
    const mark = /^\s*(?:(?:#{1,6}|>|[-*+]|\d+[.)])\s+)*/.exec(line)![0];
    return mark + muted(line.slice(mark.length));
  }).join('\n');
}

/**
 * Blank space around a rule. The hover sanitizer keeps `style` only on `<span>` and only for
 * colour/background/display/border-radius (no margin/height), so spacing is a standalone `<br>` block
 * (allowed by the sanitizer) on each side: one line, no paragraph margins, works after fences and quotes.
 */
const RULE = '\n\n<br>\n\n---\n\n<br>\n\n';

/**
 * Markdown for a note's hover tooltip (needs supportThemeIcons + supportHtml), note first:
 * author line + note, replies as muted blockquotes (if any), muted footer (file, range, commit, status), code snippet.
 * Sections are separated by spaced rules. `commit` is `abc1234 subject` or `Working tree`. All inserted text is escaped.
 */
export function tooltipMarkdown(c: StoredComment, commit: string, now: number): string {
  const status = c.outdated ? 'Outdated' : c.status === 'resolved' ? 'Resolved' : 'Open';
  const when = (iso: string): string => {
    const w = relativeDate(iso, now);
    return w ? ` · ${muted(w)}` : '';
  };
  let where = '$(edit) Working tree';
  if (commit !== 'Working tree') {
    const sp = commit.indexOf(' ');
    const sha = sp < 0 ? commit : commit.slice(0, sp);
    let subject = sp < 0 ? '' : commit.slice(sp + 1);
    if (subject.length > TIP_SUBJECT_MAX) {
      subject = subject.slice(0, TIP_SUBJECT_MAX - 1).trimEnd() + '…';
    }
    where = `$(git-commit) ${escapeInline(sha)}` + (subject ? ` · ${escapeInline(subject)}` : '');
  }
  const sections = [`$(comment) **${escapeInline(c.author)}**${when(c.createdAt)}\n\n${escapeBody(c.body.trimEnd())}`];
  if (c.replies.length > 0) {
    const quotes = c.replies.map(r => {
      const lines = mutedBody(escapeBody(r.body.trimEnd())).split('\n');
      lines[0] = `**${escapeInline(r.author)}**${when(r.createdAt)} — ${lines[0]}`;
      return lines.map(l => `> ${l}`.trimEnd()).join('\n');
    });
    sections.push(quotes.join('\n\n'));
  }
  sections.push(`${muted(`$(file) ${escapeInline(c.file)} · ${rangeLabel(c)}`)}\n\n${muted(`${where} · ${status}`)}`);
  if (c.snippet.lines.length > 0) {
    const shown = c.snippet.lines.slice(0, TIP_CODE_LINES);
    const more = c.snippet.lines.length - shown.length;
    const code = shown.join('\n');
    const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map(m => m.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    sections.push(`${fence}${languageOf(c.file)}\n${code}\n${fence}` + (more > 0 ? '\n\n' + muted(`… ${more} more line${more === 1 ? '' : 's'}`) : ''));
  }
  return sections.join(RULE);
}

/** One line of markdown as plain text: no emphasis, code ticks, heading/list/quote markers; links keep their text. */
export function stripMarkdownLine(line: string): string {
  return line
    .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .trim();
}

/** Row label of a note: its first non-empty line as plain text. Fence lines are skipped. */
export function rowLabel(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) {
      continue;
    }
    const t = stripMarkdownLine(line);
    if (t) {
      return t;
    }
  }
  return '(empty)';
}

/** `1 note` / `2 notes`; empty for none. */
export function noteCount(n: number): string {
  return n > 0 ? `${n} note${n === 1 ? '' : 's'}` : '';
}

/** Description parts joined with ` · `, skipping empty ones. */
export function joinParts(...parts: string[]): string {
  return parts.filter(Boolean).join(' · ');
}
