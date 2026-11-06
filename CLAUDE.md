# Diff Notes (VS Code extension)

Spec: `SPEC.md`. Build order and state: `PROGRESS.md`.
Read only the SPEC sections your task names, not the whole spec.

## Rules
- TypeScript + VS Code API. Native only: diff editor, Comment API, TreeViews, `vscode.git` API. No webviews.
- `git` CLI only where `vscode.git` lacks it (commit diffs, reflog).
- Storage: JSON in `.git/diff-notes/`.
- Re-anchoring lives in `src/anchor/`: pure (no `vscode` import), unit-tested.
- Stay inside your slice. No refactors or extras outside it.

## Slice protocol
1. Read `PROGRESS.md` and the SPEC sections named in your task. Read code only as needed; no broad exploration.
2. Implement. `npm run build` and `npm test` must pass (quiet output, failures only).
3. Commit as `slice N: <summary>`.
4. In `PROGRESS.md`: tick your slice, add settled details to Decisions (one line each), add ≤5 lines to Log (built / decided / open).
5. Reply with those ≤5 lines only. No code, no diffs.
