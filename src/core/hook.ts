/** Pre-push hook script and the summary file it reads. No I/O, no vscode. */
import { StoredComment, WORKING_TREE } from './model';

/** Second line of every hook we write; identifies the file as ours. */
export const HOOK_MARKER = '# diff-notes pre-push hook (managed by the Diff Notes extension)';
/** An existing hook we displaced is kept next to ours under this name and run first. */
export const CHAINED_NAME = 'pre-push.diff-notes-chained';
export const HOOK_NAME = 'pre-push';

/**
 * One line per open, non-outdated comment on a commit: `sha<TAB>file<TAB>startLine<TAB>first line of body`.
 * The hook only needs this plain text, so it needs no JSON parser (or node) at push time.
 */
export function summaryText(comments: readonly StoredComment[]): string {
  const clean = (s: string): string => s.replace(/[\t\r\n]+/g, ' ').trim();
  const lines = comments
    .filter(c => c.status === 'open' && !c.outdated && c.origin !== WORKING_TREE)
    .map(c => [c.origin, clean(c.file), String(c.startLine), clean(c.body.split('\n')[0]).slice(0, 80)].join('\t'));
  return lines.length ? lines.join('\n') + '\n' : '';
}

export function isOurs(hookText: string): boolean {
  return hookText.includes(HOOK_MARKER);
}

/** POSIX sh, runs under Git for Windows' bundled sh too. Chains the displaced hook first. */
export function hookScript(): string {
  return `#!/bin/sh
${HOOK_MARKER}
# Remove by turning off "diffNotes.prePushHook".

input=$(cat)
remote="$1"
here=$(dirname "$0")

# Run the hook that was here before ours (e.g. Husky); its failure blocks the push.
if [ -x "$here/${CHAINED_NAME}" ]; then
  printf '%s\n' "$input" | "$here/${CHAINED_NAME}" "$@" || exit $?
fi

notes=$(git rev-parse --git-path diff-notes/open.txt 2>/dev/null)
[ -s "$notes" ] || exit 0

tab=$(printf '\t')
found=""
while read -r lref lsha rref rsha; do
  [ -n "$lsha" ] || continue
  case "$lsha" in *[!0]*) ;; *) continue ;; esac
  case "$rsha" in
    *[!0]*) revs=$(git rev-list "$rsha..$lsha" 2>/dev/null) || revs=$(git rev-list "$lsha" --not --remotes="$remote" 2>/dev/null) ;;
    *) revs=$(git rev-list "$lsha" --not --remotes="$remote" 2>/dev/null) ;;
  esac
  for sha in $revs; do
    hits=$(grep "^$sha$tab" "$notes")
    [ -n "$hits" ] && found="$found$hits
"
  done
done <<EOF2
$input
EOF2

[ -n "$found" ] || exit 0

{
  echo "Diff Notes: open comments on commits you are about to push:"
  printf '%s' "$found" | while IFS="$tab" read -r sha file line body; do
    [ -n "$sha" ] || continue
    printf '  %s  %s:%s  %s\n' "$(printf '%s' "$sha" | cut -c1-7)" "$file" "$line" "$body"
  done
} >&2

if ! (: </dev/tty) 2>/dev/null; then
  echo "Diff Notes: no terminal to ask on, pushing anyway." >&2
  exit 0
fi
printf 'Push anyway? [y/N] ' >/dev/tty
read -r answer </dev/tty
case "$answer" in
  y|Y|yes|YES|Yes) exit 0 ;;
  *) echo "Push cancelled." >&2; exit 1 ;;
esac
`;
}

export type InstallPlan =
  /** Nothing to do (already ours and current). */
  | { kind: 'none' }
  /** Write our script; if `chain`, first move the existing file to the chained name. */
  | { kind: 'write'; chain: boolean };

/** `existing` = current contents of the hook file, or undefined if absent. */
export function planInstall(existing: string | undefined): InstallPlan {
  if (existing === undefined) {
    return { kind: 'write', chain: false };
  }
  if (isOurs(existing)) {
    return existing === hookScript() ? { kind: 'none' } : { kind: 'write', chain: false };
  }
  return { kind: 'write', chain: true };
}
