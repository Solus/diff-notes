# Backlog

## F5 checklist (built, not yet checked in a running VS Code)
- [ ] Slice 5: commit with a note, `git push` in sandbox → note moves to Pushed, counter drops.
- [ ] Slice 6: enable `diffNotes.prePushHook`, push from a terminal → list + `Push anyway? [y/N]`.
- [ ] Slice 7: rename a commented file and commit → note follows; reload → Group-by kept.
- [ ] Open File: from note title bar, list row, diff title, Commits file row; old-side note on renamed file (sandbox `src/helpers.ts`).
- [ ] Delete: trash in note box (reply vs whole note), Delete Note on rows, bulk deletes in `...` menu, auto-clear setting.
- [ ] Copy: Copy Notes button, group/note Copy, paste result.
- [ ] Group-by dropdown (check mark), File mode sub-headings under Pushed/Outdated.
- [ ] Note bodies render markdown; edit box shows raw text.
- [ ] Previous/Next Note buttons and Alt+P / Alt+N (incl. switching diff side).
- [ ] Commits list wording (`src · 1 note`, `abc1234 · 2 notes`), status icons on rows/groups.

## Known limits (accepted unless the user says otherwise)
- Notes go Outdated when lines inside their range change (accepted 2026-11-07).
- Esc can't close a comment box (VS Code 1.145 bug); Cancel works.
- Multi-repo workspaces: first repo only.
- Working-tree diff is read-only (can't edit in place).
- A note may land on the wrong commit when several unpushed commits match its snippet (newest wins).
- Old-side notes on a renamed file keep the old stored path (Open File maps it forward; storage doesn't).
- Husky regenerating `.husky/_` overwrites our pre-push hook until the extension next starts.
- Pre-push prompt only works from a terminal; IDE push buttons print the list and allow the push.
- An unsaved draft box gets no gutter marker until saved; empty drafts may linger until their diff tab closes.
- Copy as markdown guesses the code-fence language from the file extension, not VS Code's language registry.

## Brittle
- Tooltip divider spacing depends on VS Code 1.145 hover CSS — re-measure after VS Code updates.
- Alt+N / Alt+P only checked against known default keybindings.

## Ideas / deferred
- Slice 9 rest: file badges + colour, sidebar count badge (next up).
- Slice 10: note box status label, author avatar (parked).
- Upstream VS Code report for the duplicate `hideComment` registration.
