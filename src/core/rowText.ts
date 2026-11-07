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

/** Markdown for a note's hover tooltip. `commit` is `abc1234 subject` or `Working tree`. */
export function tooltipMarkdown(c: StoredComment, commit: string, now: number): string {
  const status = c.outdated ? 'Outdated' : c.status === 'resolved' ? 'Resolved' : 'Open';
  const when = relativeDate(c.createdAt, now);
  const out = [
    `**${c.file} · ${rangeLabel(c)}**`,
    `${commit} · ${status}`,
    `${c.author}${when ? ` · ${when}` : ''}`,
    c.body.trimEnd(),
    ...c.replies.map(r => `**${r.author}**: ${r.body.trimEnd()}`),
  ];
  if (c.snippet.lines.length > 0) {
    const code = c.snippet.lines.join('\n');
    const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map(m => m.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    out.push(`${fence}${languageOf(c.file)}\n${code}\n${fence}`);
  }
  return out.join('\n\n');
}
