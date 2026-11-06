# Progress

`[ ]` todo · `[x]` done · `[!]` blocked. STOP = coordinator waits for the user's F5 check.

## Slices
- [x] 1 Base (SPEC §1–3): scaffold; Commits TreeView (working tree, unpushed commits, files); open diff; create/edit/reply/resolve line and range comments; persist to `.git/diff-notes/`; reload on start. STOP.
- [ ] 2 Anchor module (SPEC §3–4): pure `src/anchor/`: stored snippet + new text → new range or outdated. Unit tests: unchanged, moved, partially changed, removed. No VS Code wiring.
- [ ] 3 Comments list (SPEC §5 without outdated view, §6 counter): Comments TreeView, group by commit/file/none, Open-only filter, status bar counter. STOP.
- [ ] 4 Wire anchoring (SPEC §4, §5 outdated view): re-anchor on edit, commit, amend, rebase; Outdated group; native read-only outdated view. STOP.
- [ ] 5 Pushed (SPEC §6): PUSHED separator and group, excluded from counter.
- [ ] 6 Pre-push hook (SPEC §6): opt-in setting, chains existing hooks.
- [ ] 7 Polish (SPEC §9): remembered grouping, renames and deletions, remaining open details.

## Decisions
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

## Log
- S1 built: scaffold, Commits view (working tree + unpushed commits + files), native diff, notes create/edit/reply/resolve/reopen, JSON in `.git/diff-notes/`, reload on start.
- S1 decided: read-only `diff-notes:` docs on both sides so notes stay out of normal editors.
- S1 open: working-tree diff can't be edited in place; threads don't move when the working tree changes (slice 4).
- S1 open: multi-repo workspaces use the first repo only; not yet checked in a running VS Code (needs F5).
