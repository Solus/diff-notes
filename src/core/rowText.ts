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
const TIP_CODE_LINES = 12;

/**
 * Markdown for a note's hover tooltip, in sections split by horizontal rules:
 * header (path, range, commit, status), note, replies (if any), code snippet.
 * `commit` is `abc1234 subject` or `Working tree`.
 */
export function tooltipMarkdown(c: StoredComment, commit: string, now: number): string {
  const status = c.outdated ? 'Outdated' : c.status === 'resolved' ? 'Resolved' : 'Open';
  const when = (iso: string): string => {
    const w = relativeDate(iso, now);
    return w ? ` · ${w}` : '';
  };
  const where = commit === 'Working tree' ? 'Working tree' : `commit \`${commit.replace(/`/g, "'")}\``;
  const sections = [
    `**${c.file} · ${rangeLabel(c)}**\n\n*${where} · ${status}*`,
    `**${c.author}**${when(c.createdAt)}\n\n${c.body.trimEnd()}`,
  ];
  if (c.replies.length > 0) {
    sections.push(['**Replies**', ...c.replies.map(r => `**${r.author}**${when(r.createdAt)}\n\n${r.body.trimEnd()}`)].join('\n\n'));
  }
  if (c.snippet.lines.length > 0) {
    const shown = c.snippet.lines.slice(0, TIP_CODE_LINES);
    const more = c.snippet.lines.length - shown.length;
    const code = shown.join('\n');
    const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map(m => m.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    sections.push(`${fence}${languageOf(c.file)}\n${code}\n${fence}` + (more > 0 ? `\n\n… ${more} more line${more === 1 ? '' : 's'}` : ''));
  }
  return sections.join('\n\n---\n\n');
}
