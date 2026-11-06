import { Anchor, Side, StoredComment, WORKING_TREE } from '../core/model';
import { extractSnippet, splitLines } from '../core/snippet';
import { reanchor } from './index';

/** What the resolver needs from git / the editor. Implemented in `src/anchoring.ts`; faked in tests. */
export interface AnchorEnv {
  /** Text of `file` on one side of a diff (`working-tree` or a commit SHA); '' if it does not exist. */
  readSide(origin: string, side: Side, file: string): Promise<string>;
  /** Working tree: the file's path on that side if it is still changed against HEAD (follows a rename), else undefined. */
  workingTreePath(file: string, side: Side): string | undefined;
  /** Does the commit still exist on some branch / HEAD? */
  commitAlive(sha: string): Promise<boolean>;
  /** Commits a vanished (amended/rebased) commit may have become, best guess first. */
  rewriteCandidates(sha: string): Promise<string[]>;
  /** Commits new working-tree changes may have been committed in, newest first. */
  landingCandidates(): Promise<string[]>;
  /** The file's path on that side if the commit changes it (follows a rename), else undefined. */
  commitPath(sha: string, side: Side, file: string): Promise<string | undefined>;
}

async function anchorIn(c: StoredComment, origin: string, file: string, env: AnchorEnv): Promise<Anchor | undefined> {
  const lines = splitLines(await env.readSide(origin, c.side, file));
  const r = reanchor(c.snippet, c.startLine, lines);
  if (r.status !== 'anchored') {
    return undefined;
  }
  return { outdated: false, origin, file, startLine: r.startLine, endLine: r.endLine, snippet: extractSnippet(lines, r.startLine, r.endLine) };
}

async function firstAnchor(c: StoredComment, shas: string[], env: AnchorEnv): Promise<Anchor | undefined> {
  for (const sha of shas) {
    const file = sha === c.origin ? undefined : await env.commitPath(sha, c.side, c.file);
    if (file !== undefined) {
      const a = await anchorIn(c, sha, file, env);
      if (a) {
        return a;
      }
    }
  }
  return undefined;
}

/**
 * Where does this comment live now?
 * - working tree: re-matched in the file; if the file is no longer changed, look for the commit it landed in;
 * - commit: unchanged while the commit exists; if it vanished (amend/rebase), look in the rewritten commit.
 * A renamed file is followed to its new path. Anything not found is outdated (never resolved automatically).
 */
export async function resolveComment(c: StoredComment, env: AnchorEnv): Promise<Anchor> {
  if (c.origin === WORKING_TREE) {
    const file = env.workingTreePath(c.file, c.side);
    if (file !== undefined) {
      return (await anchorIn(c, WORKING_TREE, file, env)) ?? { outdated: true };
    }
    return (await firstAnchor(c, await env.landingCandidates(), env)) ?? { outdated: true };
  }
  if (await env.commitAlive(c.origin)) {
    return { outdated: false, origin: c.origin, file: c.file, startLine: c.startLine, endLine: c.endLine, snippet: c.snippet };
  }
  return (await firstAnchor(c, await env.rewriteCandidates(c.origin), env)) ?? { outdated: true };
}
