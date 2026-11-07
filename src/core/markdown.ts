/** Notes -> markdown for the clipboard. No vscode import. */
import { StoredComment, WORKING_TREE } from './model';

export interface MdSection {
  /** `## heading`; omitted for loose (ungrouped) notes. */
  heading?: string;
  /** All notes of the section (used for counting). */
  notes: StoredComment[];
  /** If set, rendered instead of `notes`, each as `### heading`. */
  subsections?: MdSection[];
}

const LANGS: Record<string, string> = {
  ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'jsonc', md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  cs: 'csharp', cpp: 'cpp', cc: 'cpp', c: 'c', h: 'c', hpp: 'cpp', php: 'php', swift: 'swift', sh: 'shellscript', bash: 'shellscript',
  ps1: 'powershell', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less', yml: 'yaml', yaml: 'yaml', xml: 'xml',
  sql: 'sql', vue: 'vue', svelte: 'svelte', lua: 'lua', dart: 'dart', toml: 'toml', ini: 'ini', txt: 'plaintext',
};

/** Language id for a file path, guessed from its extension (empty if unknown). */
export function languageOf(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  if (base === 'dockerfile') {
    return 'dockerfile';
  }
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : (LANGS[base.slice(dot + 1)] ?? '');
}

function indent(text: string, pad: string): string {
  return text.split(/\r?\n/).map(l => (l ? pad + l : l)).join('\n');
}

/** `path:L5-7` / `path:L5`. */
function where(c: StoredComment): string {
  return `${c.file}:L${c.startLine}${c.endLine > c.startLine ? `-${c.endLine}` : ''}`;
}

/** One note as a checklist item. `commitLabel(origin)` gives e.g. `abc1234 subject` or `Working tree`. */
export function noteToMarkdown(c: StoredComment, commitLabel: (origin: string) => string): string {
  const pad = '  ';
  const lines = c.body.split(/\r?\n/);
  const firstIdx = Math.max(0, lines.findIndex(l => l.trim()));
  const first = (lines[firstIdx] ?? '').trim();
  const rest = lines.slice(firstIdx + 1).join('\n').replace(/^\s*\n/, '').trimEnd();
  const out = [`- [${c.status === 'resolved' ? 'x' : ' '}] ${where(c)} (${commitLabel(c.origin)}) — ${first}`];
  if (rest.trim()) {
    out.push(indent(rest, pad));
  }
  for (const r of c.replies) {
    out.push(indent(`${r.author}: ${r.body.trimEnd()}`, pad));
  }
  if (c.snippet.lines.length > 0) {
    const code = c.snippet.lines.join('\n');
    const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map(m => m.length));
    const fence = '`'.repeat(Math.max(3, longest + 1));
    out.push(indent(`${fence}${languageOf(c.file)}\n${code}\n${fence}`, pad));
  }
  return out.join('\n');
}

/** Whole clipboard text: sections separated by a blank line, headings as `## label`. */
export function notesToMarkdown(sections: readonly MdSection[], commitLabel: (origin: string) => string): string {
  return (
    sections
      .filter(s => s.notes.length > 0)
      .map(s =>
        [
          ...(s.heading !== undefined ? [`## ${s.heading}`, ''] : []),
          s.subsections?.length
            ? s.subsections.filter(x => x.notes.length > 0).map(x => `### ${x.heading}\n\n${x.notes.map(n => noteToMarkdown(n, commitLabel)).join('\n')}`).join('\n\n')
            : s.notes.map(n => noteToMarkdown(n, commitLabel)).join('\n'),
        ].join('\n'),
      )
      .join('\n\n') + '\n'
  );
}

export const countNotes = (sections: readonly MdSection[]): number => sections.reduce((n, s) => n + s.notes.length, 0);

/** Fallback label when no commit subject is known. */
export const shortOrigin = (origin: string): string => (origin === WORKING_TREE ? 'Working tree' : origin.slice(0, 7));
