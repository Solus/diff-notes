import { AnchorEnv, resolveComment } from './anchor/resolve';
import { ChangedFile } from './core/gitParse';
import { Side, StoredComment, WORKING_TREE } from './core/model';
import { CommentStore } from './core/store';
import { GitService } from './git';

/** Path of `file` on `side` after the change `f`: same path, or the new name when `f` renames it; undefined if `f` is another file. */
const pathAfter = (f: ChangedFile, side: Side, file: string): string | undefined => {
  if (side === 'new') {
    return f.path === file ? file : f.status === 'R' && f.oldPath === file ? f.path : undefined;
  }
  return (f.oldPath ?? f.path) === file ? file : undefined;
};
const findPath = (files: ChangedFile[], side: Side, file: string): string | undefined => {
  for (const f of files) {
    const p = pathAfter(f, side, file);
    if (p !== undefined) {
      return p;
    }
  }
  return undefined;
};

/**
 * Re-anchors stored comments against the repo: working-tree comments on every run,
 * commit comments when HEAD moved (commit, amend, rebase, checkout) and on the first run.
 * Runs are serialized; a request during a run triggers one more run afterwards.
 */
export class Anchoring {
  private lastHead: string | undefined;
  private first = true;
  private running: Promise<void> | undefined;
  private again = false;

  constructor(
    private readonly store: CommentStore,
    private readonly git: GitService,
    /** Called with the comments whose anchor changed; saves and refreshes. */
    private readonly onChanged: (changed: StoredComment[]) => Promise<void>,
  ) {}

  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again);
      } finally {
        this.running = undefined;
      }
    })();
    return this.running;
  }

  private async pass(): Promise<void> {
    const head = this.git.headSha;
    const headMoved = this.first || head !== this.lastHead;
    const env = this.env();
    const changed: StoredComment[] = [];
    let failed = false;
    for (const c of [...this.store.all()]) {
      if (c.origin !== WORKING_TREE && !headMoved) {
        continue;
      }
      try {
        if (this.store.setAnchor(c.id, await resolveComment(c, env))) {
          changed.push(c);
        }
      } catch {
        // git hiccup (e.g. index lock mid-operation): keep the comment as is, retry on the next run
        failed = true;
      }
    }
    this.first = failed;
    this.lastHead = head;
    if (changed.length > 0) {
      await this.onChanged(changed);
    }
  }

  private env(): AnchorEnv {
    const git = this.git;
    const files = new Map<string, Promise<ChangedFile[]>>();
    const alive = new Map<string, Promise<boolean>>();
    const wt = git.workingTreeFiles();
    return {
      readSide: (origin, side, file) => git.readSide(file, { origin, side }),
      workingTreePath: (file, side) => findPath(wt, side, file),
      commitAlive: sha => alive.get(sha) ?? alive.set(sha, git.commitAlive(sha)).get(sha)!,
      rewriteCandidates: sha => git.rewriteCandidates(sha),
      landingCandidates: async () => (await git.unpushedCommits()).map(c => c.sha),
      commitPath: async (sha, side, file) => {
        const list = files.get(sha) ?? files.set(sha, git.commitFiles(sha).catch(() => [])).get(sha)!;
        return findPath(await list, side, file);
      },
    };
  }
}
