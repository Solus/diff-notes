# Progress

`[ ]` todo · `[x]` done · `[!]` blocked. STOP = coordinator waits for the user's F5 check.

## Slices
- [x] 1 Base (SPEC §1–3): scaffold; Commits TreeView (working tree, unpushed commits, files); open diff; create/edit/reply/resolve line and range comments; persist to `.git/diff-notes/`; reload on start. STOP.
- [x] 2 Anchor module (SPEC §3–4): pure `src/anchor/`: stored snippet + new text → new range or outdated. Unit tests: unchanged, moved, partially changed, removed. No VS Code wiring.
- [x] 3 Comments list (SPEC §5 without outdated view, §6 counter): Comments TreeView, group by commit/file/none, Open-only filter, status bar counter. STOP.
- [x] 4 Wire anchoring (SPEC §4, §5 outdated view): re-anchor on edit, commit, amend, rebase; Outdated group; native read-only outdated view. STOP.
- [x] 5 Pushed (SPEC §6): PUSHED separator and group, excluded from counter.
- [x] 6 Pre-push hook (SPEC §6): opt-in setting, chains existing hooks.
- [x] 7 Polish (SPEC §9): remembered grouping, renames and deletions, remaining open details.
- [x] 8 Diff markers: commented lines get a soft background tint and a gutter note icon, plus scrollbar (overview ruler) marks; colours as contributed theme colours with defaults. STOP.
- [ ] 9 Panel polish: tinted status icon per note (open/resolved/outdated/pushed), rich markdown tooltips (full text, author, date, range), file badges + colour for files with open notes, open-notes count badge on the sidebar icon (tooltips done early). STOP.
- [ ] 10 Note box: status label on notes (Resolved, Outdated), git user name as author with an avatar icon. STOP.

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
- Group-by choice is saved in workspaceState (`diffNotes.groupBy`); Open-only stays on at start (SPEC: on by default).
- Renames: a comment on a renamed file follows it (new side only; working tree and landing/rewritten commits) and its stored `file` is updated. Deleted files: new-side comments go outdated; old-side comments on a commit stay.
- Commits view shows ` · N open notes` on working tree, commit and file rows (open, non-outdated only).
- Markers: one decoration type (amber gutter stripe from `media/note-stripe-{light,dark}.svg`, stretched via `gutterIconSize: '100% 100%'`; overview ruler Right lane) applied by `src/markers.ts` to visible `diff-notes:` editors; lines from pure `markerSpans` (open, non-outdated, same file/origin/side). Colour `diffNotes.overviewRulerMarker` (amber). No line tint/border (clashed with diff green). Refreshed on every persist, re-anchor, and editor visibility/document open.
- Notes going Outdated when lines change inside their range is accepted (user, 2026-11-07); no fuzzier anchoring planned.
- Delete: trash on every comment in the note box; a reply goes at once, the first comment deletes the whole note (modal "Delete" confirm only if it has replies); "Delete Note" on list rows, same rule; works in the Outdated view. Pure store ops `remove`/`removeReply`.
- Cleanup: Delete All Resolved/Pushed/Outdated in the Comments `...` menu (modal with count, info message at 0). `diffNotes.autoClearPushedDays` (0 = off) deletes notes whose optional `pushedAt` (stamped when first seen as pushed, cleared if back on an unpushed commit) is older than N days; runs after startup anchoring and each git change, skipped if the unpushed list can't be read (`tryUnpushed`). Logic in `src/core/cleanup.ts`.
- Copy as markdown: `visibleList` (core) is the single source for what the list shows, used by both the tree and Copy; format in `src/core/markdown.ts` (`## group`, `- [ ]/[x] path:L5-7 (sha subject) — first line`, indented rest/replies/fenced snippet). Language id guessed from file extension (core map), not VS Code's language registry.

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
- S7 built: remembered Group-by per workspace; comments follow file renames; Commits view note counts (SPEC §5 badges); 2 tests added.
- S7 decided: rename following covers the new side only; SPEC §9 counter question settled (working tree counts).
- S7 open: not checked in a running VS Code (F5: rename a commented file and commit; reload and see Group-by kept); multi-repo still first repo only; working-tree diff still not editable in place; old-side comments on a renamed file are not re-pathed.
- Fix: Cancel button crashed (VS Code passes the reply box object, not the thread); now closes empty drafts, collapses existing threads; Esc closes the editor. Esc not checked in a running VS Code.
- Fix: Esc did nothing because VS Code already binds Esc to hideComment, which only flips a thread to Collapsed; a brand-new empty box is already 'collapsed', so no change fires (read from VS Code 1.145 source, not run). Our duplicate Esc binding removed; built-in Esc still hides existing notes. Cancel always closes without asking (new empty box disposed, existing note collapsed); empty drafts we have seen are disposed when their diff tab closes. Open: Esc on a brand-new box still no-op; keybindings cannot read the box text.
- Esc root cause (confirmed under F5 with a debugger, VS Code 1.145.2): VS Code registers `workbench.action.hideComment` twice; the later alt+Backspace handler replaces the Esc one and finds no controller for a comment box, so Esc is a no-op everywhere (VS Code bug; supersedes the line above). Decided: no Esc workaround; Cancel is the way to close a note. New notes: Cancel only. Candidate upstream report.
- S8 built: amber line tint, gutter note icon and scrollbar marks for open notes on both diff sides; two contributed theme colours with light/dark/HC defaults; 1 test.
- S8 decided: resolved and outdated notes get no marker; refresh piggybacks on persist and re-anchor.
- S8 open: not checked in a running VS Code (F5): gutter icon (glyph margin) vs VS Code's "+" (line-decoration strip) are different columns so should coexist, unverified; a pending unsaved draft box gets no marker until saved.
- S8 follow-up: tint and left border replaced by a full-line-height amber gutter stripe (light/dark SVGs); VS Code's own comment glyph may cover the stripe on the anchor line (accepted); not yet eyeballed under F5.
- fix: opening a note no longer selects text; cursor at note start, range scrolled into view, thread expanded (also Outdated view and Open Current Diff). Note thread/marker ranges still end at col 0 of the last line (comments.ts sync, openOutdatedThread); left unchanged.
- fix: note range covers its last line; thread ranges now end at end-of-line (clamped col), and a new thread's range ending at col 0 of a later line is stored without that extra line (src/core/threadRange.ts, tested). Not checked in a running VS Code.
- feat: Open File button (note title bar in diff and Outdated view, Comments list row) opens the real file at the note's line, re-anchored from its snippet; falls back to stored line with a status bar message; missing file shows an info message. Not checked in a running VS Code.
- Delete + cleanup built: trash button, Delete Note, three bulk deletes, auto-clear setting; 5 tests. Not checked under F5 (modal wording, `...` menu placement, trash icon order next to Edit).
- Copy built: Copy Notes title button, Copy on group and note rows, "Copied N notes" status message; 5 tests. Not checked under F5 (clipboard paste, button order).
- ui: Group By is now a title-bar dropdown (submenu with Commit/File/None, check mark on current via `diffNotes.groupMode` context key); old quick pick removed. Not checked under F5.
- ui: denser comment rows (description trimmed by group mode, pure `src/core/rowText.ts`) and rich markdown tooltips (path, commit, status, author/age, body, replies, snippet). Not checked under F5.
- ui: in Group by File, PUSHED and Outdated hold per-file sub-headings (rows show `L5–7 · sha`); Copy Notes / group Copy emit `###` sub-headings, sub-heading Copy copies one file. Not checked under F5.
- sandbox: realistic multi-language project (TS services, Python report, README, config), 2 pushed + 4 unpushed commits (move, rename, delete, bugfix), working-tree/staged/untracked changes, 15 seeded notes (old/new side, ranges, resolved, replies, long body, PUSHED, Outdated, renamed file); seed files in scripts/sandbox-seed/, deterministic SHAs. Notes seeded by writing comments.json directly (snippets via the extension's rules); not opened under F5.
