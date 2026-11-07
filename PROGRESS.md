# Progress

`[ ]` todo · `[x]` done · `[!]` blocked. STOP = coordinator waits for the user's F5 check.
Follow-ups, known limits and the F5 checklist: `BACKLOG.md`.

## Current state
- Slices 1–8 done, plus extras: delete/cleanup/auto-clear, copy as markdown, Group-by dropdown, Open File (follows renames), Previous/Next Note, markdown note bodies, note-first tooltips, realistic sandbox.
- `npm run build` and `npm test` pass; tree clean; pushed to private GitHub repo `Solus/diff-notes`, branch `main`.
- Confirmed under F5 by the user: slices 1–4 and 8, Cancel, gutter stripe, tooltip layout. Everything else is built but **not yet checked under F5** (list in `BACKLOG.md`).
- Slice 9 half done (status icons, tooltips). Slice 10 parked (user: functionality first, polish later).

## Next steps
1. **User F5 pass** over the unchecked list in `BACKLOG.md`; fix what fails (fix-up subagents use systematic-debugging).
2. **Slice 9 rest — brief for an implementer:** Goal: in the Commits view, file rows with open notes get a badge and colour (FileDecorationProvider on the `diff-notes:` file URIs used by Commits rows), and the Diff Notes sidebar icon shows the open-notes count (TreeView `badge` on the Comments view, same count as the status bar). Area: `src/` view code; count logic already in `src/core/commentList.ts`. Verify: `npm run build && npm test`; add a pure test if new logic is added. Done: both visible under F5 in `sandbox/`, slice 9 ticked, PROGRESS updated per slice protocol.
3. Slice 10 (note box status label, author avatar) when the user asks.

## Open decisions
- Slice 10 scope: status label on notes and author avatar — parked, user to say when.
- Report the Esc bug (`hideComment` registered twice) to VS Code upstream? Not decided.
- Multi-repo workspaces (first repo only) — leave or support? Not discussed.

## Gotchas
- Subagent "tests pass" claims are not proof — always run `npm run build && npm test` yourself (a tooltip test once failed after a "passing" report).
- F5 opens `sandbox/`; VS Code won't open a folder already open in another window (gives an empty window). `npm run sandbox:reset` rebuilds the sandbox and its notes.
- Media paths: use `ctx.extensionUri`, not `__dirname` (that is `out/`).
- Comment-menu commands receive the reply-box object, not the thread.
- Any command with an icon must be in a menu — `test/menus.test.ts` enforces it.
- VS Code only auto-scrolls a diff to a note when exactly one thread is expanded; we jump explicitly.
- Esc in comment boxes is broken in VS Code 1.145 (its bug); Cancel is the close path. Don't add workarounds.
- Hover sanitizer: `style` only on `<span>`, only colour/background/display/border-radius. Tooltip divider spacing is tuned to VS Code 1.145 hover CSS (measured in headless Chromium) — re-check after VS Code updates; don't guess spacing, measure.
- Hook tests run real `git push` with Git for Windows `sh`.

## Slices
- [x] 1 Base (SPEC §1–3): scaffold; Commits TreeView (working tree, unpushed commits, files); open diff; create/edit/reply/resolve line and range comments; persist to `.git/diff-notes/`; reload on start. STOP.
- [x] 2 Anchor module (SPEC §3–4): pure `src/anchor/`: stored snippet + new text → new range or outdated. Unit tests: unchanged, moved, partially changed, removed. No VS Code wiring.
- [x] 3 Comments list (SPEC §5 without outdated view, §6 counter): Comments TreeView, group by commit/file/none, Open-only filter, status bar counter. STOP.
- [x] 4 Wire anchoring (SPEC §4, §5 outdated view): re-anchor on edit, commit, amend, rebase; Outdated group; native read-only outdated view. STOP.
- [x] 5 Pushed (SPEC §6): PUSHED separator and group, excluded from counter.
- [x] 6 Pre-push hook (SPEC §6): opt-in setting, chains existing hooks.
- [x] 7 Polish (SPEC §9): remembered grouping, renames and deletions, remaining open details.
- [x] 8 Diff markers: commented lines get a soft background tint and a gutter note icon, plus scrollbar (overview ruler) marks; colours as contributed theme colours with defaults. STOP.
- [ ] 9 Panel polish: tinted status icon per note (open/resolved/outdated/pushed) (done), rich markdown tooltips (full text, author, date, range) (done), file badges + colour for files with open notes, open-notes count badge on the sidebar icon . STOP.
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
- Commits view shows `N notes` (open, non-outdated) in the description of working tree, commit and file rows (file: `dir · 1 note`, no git letter) (open, non-outdated only).
- Markers: one decoration type (amber gutter stripe from `media/note-stripe-{light,dark}.svg`, stretched via `gutterIconSize: '100% 100%'`; overview ruler Right lane) applied by `src/markers.ts` to visible `diff-notes:` editors; lines from pure `markerSpans` (open, non-outdated, same file/origin/side). Colour `diffNotes.overviewRulerMarker` (amber). No line tint/border (clashed with diff green). Refreshed on every persist, re-anchor, and editor visibility/document open.
- Notes going Outdated when lines change inside their range is accepted (user, 2026-11-07); no fuzzier anchoring planned.
- Delete: trash on every comment in the note box; a reply goes at once, the first comment deletes the whole note (modal "Delete" confirm only if it has replies); "Delete Note" on list rows, same rule; works in the Outdated view. Pure store ops `remove`/`removeReply`.
- Cleanup: Delete All Resolved/Pushed/Outdated in the Comments `...` menu (modal with count, info message at 0). `diffNotes.autoClearPushedDays` (0 = off) deletes notes whose optional `pushedAt` (stamped when first seen as pushed, cleared if back on an unpushed commit) is older than N days; runs after startup anchoring and each git change, skipped if the unpushed list can't be read (`tryUnpushed`). Logic in `src/core/cleanup.ts`.
- Copy as markdown: `visibleList` (core) is the single source for what the list shows, used by both the tree and Copy; format in `src/core/markdown.ts` (`## group`, `- [ ]/[x] path:L5-7 (sha subject) — first line`, indented rest/replies/fenced snippet). Language id guessed from file extension (core map), not VS Code's language registry.

## Log
- S1–S8 built per slice lines above; extras and fixes since (all committed, see `git log`).
- Detailed per-slice open items moved to `BACKLOG.md` (2026-11-07 handoff).
