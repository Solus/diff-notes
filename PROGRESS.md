# Progress

`[ ]` todo · `[x]` done · `[!]` blocked. STOP = coordinator waits for the user's F5 check.

## Slices
- [x] 1 Base (SPEC §1–3): scaffold; Commits TreeView (working tree, unpushed commits, files); open diff; create/edit/reply/resolve line and range comments; persist to `.git/diff-notes/`; reload on start. STOP.
- [x] 2 Anchor module (SPEC §3–4): pure `src/anchor/`: stored snippet + new text → new range or outdated. Unit tests: unchanged, moved, partially changed, removed. No VS Code wiring.
- [x] 3 Comments list (SPEC §5 without outdated view, §6 counter): Comments TreeView, group by commit/file/none, Open-only filter, status bar counter. STOP.
- [x] 4 Wire anchoring (SPEC §4, §5 outdated view): re-anchor on edit, commit, amend, rebase; Outdated group; native read-only outdated view. STOP.
- [x] 5 Pushed (SPEC §6): PUSHED separator and group, excluded from counter.
- [x] 6 Pre-push hook (SPEC §6): opt-in setting, chains existing hooks.
- [ ] 7 Polish (SPEC §9): remembered grouping, renames and deletions, remaining open details.

## Decisions
- F5 opens `sandbox/` (throwaway repo from `npm run sandbox`; `sandbox:reset` recreates; both gitignored with `sandbox-remote.git`).
- Both diff sides are read-only `diff-notes:/<path>?origin=<sha|working-tree>&side=<old|new>` docs; this keeps comments out of normal editors (cost: working-tree diff is not editable).
- Sides: commit old = first parent (`sha^`), commit new = `sha`; working tree old = `HEAD`, new = file on disk.
- Unpushed = `@{upstream}..HEAD`; with no upstream, `HEAD --not --remotes` (cap 200).
- git CLI used for: commit list (log), commit files (`diff-tree --diff-merges=first-parent`). vscode.git for state, working-tree changes, file content, `user.name`.
- Storage file: `<gitdir>/diff-notes/comments.json` (follows `.git` file pointer); atomic write; unreadable file = no saving that session.
- Snippet = `{before, lines, after}`, 3 context lines each side; lines are 1-based inclusive.
- One thread per stored comment; replies are a flat list; edit works on comment and replies.
- Resolved threads are kept in the diff, collapsed and marked Resolved (so Reopen is reachable).
- Single repo: first one the git extension opens.
- Pure, vscode-free code in `src/core/`; tests = `node --test` on compiled `out/test`.

- Anchor: `reanchor(snippet, oldStart, newLines)` in `src/anchor/index.ts` -> `{anchored,startLine,endLine}` | `{outdated}`; range length kept, positional match per window, trimmed, blank lines ignored; anchored if > 50% of non-blank lines match; ties: more context matches, then nearest old position.

- Activation never awaits a repo; setup runs when the first repo opens (now or later). F5 opens this repo.
- Comments list: pure grouping/count in `src/core/commentList.ts`; group mode and Open-only live in memory only (remembering = slice 7). Commit-mode order: working tree, unpushed commits, then "(not in unpushed list)" groups (becomes PUSHED/Outdated in slices 4-5).
- Counter = open comments on working tree + unpushed SHAs; status bar item left, click focuses Comments view.
- Clicking a comment opens its commit/working-tree diff with the range selected (selection applies to the new side).
- Anchoring: `resolveComment(comment, env)` in `src/anchor/resolve.ts` (pure, env faked in tests); `src/anchoring.ts` runs it serialized: working-tree comments every run, commit comments only when HEAD moved (and at start).
- Triggers: git state change or file save, debounced 300 ms. Re-anchoring refreshes the stored snippet/range; WT comment whose file is no longer changed moves to the newest unpushed commit that touches the file and still matches, else outdated.
- Commit "vanished" = not reachable from any ref or HEAD. Rewritten commit = same author+subject in last 200 of HEAD, then unpushed commits; must touch the file and match the snippet. Old objects are read from git (no reflog needed).
- Outdated = `outdated: true` on the stored comment (last known origin/range/snippet kept); retried on later runs, can become anchored again. Own last group "Outdated" in every mode; not counted in the status bar.
- Outdated view: read-only `diff-notes-outdated:/<file>?id=` doc with the snippet; thread created on open; title button "Open Current Diff". Thread contextValue: open|resolved|outdated-open|outdated-resolved.
- PUSHED group (`kind 'pushed'`) = non-outdated comments on a commit not in the unpushed list; own group in every mode, placed before Outdated, shows commit per row; not counted.
- Pre-push hook: setting `diffNotes.prePushHook` (default off) installs/removes `<hooksdir>/pre-push` (hooks dir from `git rev-parse --git-path hooks`, so Husky's core.hooksPath is honoured). Script/plan in `src/core/hook.ts`, file work in `src/hook.ts`.
- Hook reads plain `<gitdir>/diff-notes/open.txt` (`sha<TAB>file<TAB>line<TAB>text`, open non-outdated commit comments), rewritten on every save and on enabling; no node/JSON at push time. Pushed commits = `remote_sha..local_sha` (new branch: `--not --remotes=<remote>`).
- Chaining: a foreign pre-push is moved to `pre-push.diff-notes-chained` and run first with the same args/stdin (its failure blocks); turning the setting off deletes ours and restores it. Prompt reads `/dev/tty`; with no terminal it prints the list and allows the push.

## Log
- S1 built: scaffold, Commits view (working tree + unpushed commits + files), native diff, notes create/edit/reply/resolve/reopen, JSON in `.git/diff-notes/`, reload on start.
- S1 decided: read-only `diff-notes:` docs on both sides so notes stay out of normal editors.
- S1 open: working-tree diff can't be edited in place; threads don't move when the working tree changes (slice 4).
- S1 open: multi-repo workspaces use the first repo only; not yet checked in a running VS Code (needs F5).
- S2 built: pure `src/anchor/` `reanchor` + 11 tests (unchanged, moved, partial, removed, duplicates, whitespace).
- S2 open: lines inserted/deleted inside a range change its length, so it falls back to positional matching; commit-SHA lookup (reflog) is slice 4.
- S3 built: Comments view (group by Commit/File/None via title button, Open-only toggle), click opens diff at the range, status bar counter; 5 tests.
- S3 decided: comments on commits not in the unpushed list go in a temporary "not in unpushed list" group.
- S3 open: not checked in a running VS Code (needs F5); old-side comments select the range on the new side only; Commits-view comment badges not done (not in this slice's task).
- S4 built: re-anchoring on save/commit/amend/rebase/checkout; working-tree comments move to the commit they land in; Outdated group and read-only outdated view with reply/resolve/Open Current Diff; 9 tests.
- S4 decided: outdated comments do not count in the status bar; "(not in unpushed list)" now only holds pushed commits until slice 5.
- S4 open: not checked in a running VS Code (needs F5: edit a commented file, commit, amend, rebase -i); multi-commit landing picks the newest matching commit; "Open Current Diff" on a vanished commit relies on git still holding the object.
- S5 built: PUSHED group replaces "(not in unpushed list)" in all group modes (before Outdated); excluded from counter; 2 tests changed/added.
- S5 decided: pushed comments stay in the PUSHED group even in File mode (not mixed into file groups).
- S5 open: not checked in a running VS Code (needs F5: commit with a note, `git push` in sandbox, see it move to PUSHED and counter drop).
- S6 built: opt-in `diffNotes.prePushHook` setting; hook lists open comments on pushed commits and asks `Push anyway? [y/N]`; chains existing hooks; 5 tests incl. real git push with Git for Windows sh.
- S6 decided: no terminal (e.g. push from an IDE) = list printed, push allowed; summary file keeps the hook free of JSON parsing.
- S6 open: not checked in a running VS Code (needs F5 on sandbox: enable setting, comment on a commit, `git push` in a terminal); if Husky regenerates its hooks dir (`.husky/_`) our hook is overwritten until the extension next starts; the y/N answer path was tested via a faked tty file, not a real console.
