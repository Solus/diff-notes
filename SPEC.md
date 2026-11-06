# Diff Notes: VS Code extension spec

Repo `diff-notes`, extension ID `bero-labs.diff-notes`, display name "Diff Notes".

PR-style line comments on **local, unpushed commits and uncommitted changes**, for your own reference ("what to change before I push"). No remote, no account. Mockups: https://claude.ai/artifact/Cm1YNosTjucRQLGMnJzLX4 (5 screens; use as the UI reference).

Principle: **use native VS Code as much as possible** (diff editor, Comment API, TreeViews, built-in Git extension, theming). Native was chosen over webviews for maintenance, theming and accessibility. Do not add webviews.

Stack: TypeScript, VS Code extension API. Repo state via the built-in Git extension API (`vscode.git`). Shell out to `git` only for what that API doesn't give (commit diffs, reflog).

## 1. What you review

- Entry list: **Working tree** (uncommitted changes, diffed against HEAD) at the top, then **unpushed commits** (`@{upstream}..HEAD`), newest first. Pushed commits that still have unresolved comments are listed below a "PUSHED" separator.
- Each entry expands to its changed files. Click a file to open the native diff editor (parent ↔ commit; HEAD ↔ working tree).
- Reviewing is **per commit**, not one combined diff.
- Comments appear **only in diffs**, not in the normal editor (possible later toggle, out of scope now).

## 2. Commenting

- In the diff editor: gutter `+` on one line, or drag for a range. Works on both sides (added and deleted lines). Native Comment API; inline box under the last selected line.
- Thread header shows the range (e.g. `L22–25`). Ctrl+Enter saves, Cancel discards the draft.
- After saving: edit, reply, **resolve manually**, reopen. Resolved comments are hidden, never deleted.

## 3. Storage

- `.git/diff-notes/` (never committed, no gitignore needed, tied to the clone). JSON, readable by tools (e.g. an agent can read it later).
- Each comment stores:
  - `id`, `author`, `createdAt`, `body`, replies, `status` (open | resolved)
  - `file`, `side` (old | new), `startLine`, `endLine`
  - `snippet`: the commented lines' text plus a few lines of surrounding context
  - `origin`: commit SHA, or `working-tree`
- Suggested schema versioning: `{ "version": 1, "comments": [...] }`.

## 4. Re-anchoring (the hard part)

Comments must survive edits, amends and rebases, so they are matched by snippet, not by `sha + line`.

- **Working-tree comments:** re-matched when the file changes. After you commit, they move to the new commit if the lines match.
- **Commit comments whose SHA vanished (amend/rebase):** find the rewritten commit via reflog, or by matching commit message + author, then match the snippet in that commit's diff.
- **Moved but unchanged code:** the comment follows it.
- **Partially changed range:** stays anchored if most of the original lines still match; otherwise outdated. Threshold is a tunable default (start with "majority of lines match").
- **Can't be matched → Outdated.** Never auto-resolved. Only manual resolve.

## 5. Sidebar (one container, two native TreeViews)

**Commits:** as in section 1, with a comment-count badge per commit and file.

**Comments:**
- Title-bar "Group by" button (quick pick): **Commit** (default) | **File** | **None** (flat, commit order). Choice remembered per workspace.
- "Open only" filter on by default; toggle to show Resolved.
- Commit grouping order mirrors the Commits list, with the working tree first and "PUSHED" separated below.
- **Outdated** is its own group in every mode ("commit rewritten"), since there is no commit to group it under.
- Entry shows the first line of the comment plus `file · L22–25` (plus the commit when not grouped by commit).
- Clicking an entry jumps to the comment in its diff.

**Outdated comment (native):** clicking one opens the stored snippet in a **read-only editor** (file's language, so syntax highlighting is free), with the comment attached as a Comment API thread (Outdated tag, Resolve, Reply, "Open current diff"). No webview. See mockup screen 4.

The built-in Comments panel will also list live threads for free. Outdated comments don't appear there, which is why our own Comments list is needed.

## 6. Push behaviour

- **Status bar counter:** number of open comments on **unpushed** commits (and working tree). Always on. Click opens the Comments list.
- **Opt-in `pre-push` git hook** (setting, **off by default**): lists open comments and asks `Push anyway? [y/N]`. Must **chain** existing hooks (e.g. Husky) rather than overwrite them. Catches terminal pushes too.
- No VS Code push-button interception (not needed: pushes are done from the terminal).
- **Comments on commits that were pushed anyway** stay visible, marked "pushed", don't count toward the counter, and sit in a "PUSHED" group.

## 7. Out of scope for now

- Showing comments in the normal editor
- Webviews
- Remote/shared comments, syncing between clones
- AI-generated reviews
- Intercepting the VS Code Source Control push button

## 8. Build order

See `PROGRESS.md`. Re-anchoring is the riskiest piece, so it's built early as a pure, unit-tested module (input: stored snippet + new file/diff text; output: new range or "outdated"), before it's wired to VS Code.

## 9. Open details to settle while building

- Exact snippet context size (lines before/after).
- Partial-change threshold for "still anchored".
- Handling renames and file deletions in a commit.
- Whether the status bar counter includes working-tree comments (assumed yes).
