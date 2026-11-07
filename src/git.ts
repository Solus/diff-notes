import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffSide, gitRefFor } from './core/diffRef';
import { ChangedFile, CommitInfo, LOG_FORMAT, mergeWorkingChanges, parseLog, parseNameStatusZ, RawChange } from './core/gitParse';
import { API, Change, Repository } from './gitApi';

const MAX_COMMITS = 200;
const SEP = String.fromCharCode(0x1f);

/** Repo access: vscode.git for state/content, `git` CLI for commit lists and commit diffs. */
export class GitService {
  readonly root: string;

  constructor(private readonly api: API, readonly repo: Repository) {
    this.root = repo.rootUri.fsPath;
  }

  get onDidChange(): vscode.Event<void> {
    return this.repo.state.onDidChange;
  }

  abs(relPath: string): string {
    return path.join(this.root, ...relPath.split('/'));
  }

  rel(fsPath: string): string {
    return path.relative(this.root, fsPath).split(path.sep).join('/');
  }

  /** Unpushed commits, newest first: `@{upstream}..HEAD`, or commits on no remote if there is no upstream. */
  async unpushedCommits(): Promise<CommitInfo[]> {
    return (await this.tryUnpushed()) ?? [];
  }

  /** Like `unpushedCommits`, but undefined when the list can't be determined (so callers can avoid destructive guesses). */
  async tryUnpushed(): Promise<CommitInfo[] | undefined> {
    const head = this.repo.state.HEAD;
    if (!head?.commit) {
      return undefined;
    }
    const range = head.upstream ? ['@{upstream}..HEAD'] : ['HEAD', '--not', '--remotes'];
    try {
      return parseLog(await this.run(['log', LOG_FORMAT, `-n${MAX_COMMITS}`, ...range]));
    } catch {
      return undefined;
    }
  }

  /** SHA of HEAD, if any. */
  get headSha(): string | undefined {
    return this.repo.state.HEAD?.commit;
  }

  /** True while the commit is still reachable from a branch/tag/remote or HEAD (false once amended/rebased away). */
  async commitAlive(sha: string): Promise<boolean> {
    try {
      if ((await this.run(['for-each-ref', '--contains', sha, '--count=1', 'refs/'])).trim()) {
        return true;
      }
      await this.run(['merge-base', '--is-ancestor', sha, 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Commits a vanished commit may have been rewritten into: same author and subject in recent history first,
   * then the unpushed commits. Empty if the old commit object is gone too.
   */
  async rewriteCandidates(sha: string): Promise<string[]> {
    const out: string[] = [];
    try {
      const [author, subject] = (await this.run(['log', '-1', '--format=%an%x1f%s', sha])).trimEnd().split(SEP);
      const history = await this.run(['log', `-n${MAX_COMMITS}`, '--format=%H%x1f%an%x1f%s', 'HEAD']);
      for (const line of history.split(/\r?\n/)) {
        const [h, a, s] = line.split(SEP);
        if (h && a === author && s === subject) {
          out.push(h);
        }
      }
    } catch {
      // old commit unreadable: fall back to the unpushed list only
    }
    for (const c of await this.unpushedCommits()) {
      if (!out.includes(c.sha)) {
        out.push(c.sha);
      }
    }
    return out.filter(x => x !== sha);
  }

  /** Files changed by a commit, against its first parent (or empty tree for a root commit). */
  async commitFiles(sha: string): Promise<ChangedFile[]> {
    const out = await this.run(['diff-tree', '-r', '-M', '-z', '--no-commit-id', '--name-status', '--root', '--diff-merges=first-parent', sha]);
    return parseNameStatusZ(out);
  }

  /** Uncommitted changes (staged, unstaged, untracked) relative to HEAD. */
  workingTreeFiles(): ChangedFile[] {
    const s = this.repo.state;
    const raw = (c: Change): RawChange => ({
      status: c.status,
      path: this.rel(c.uri.fsPath),
      oldPath: c.originalUri.fsPath !== c.uri.fsPath ? this.rel(c.originalUri.fsPath) : undefined,
    });
    return mergeWorkingChanges(s.indexChanges.map(raw), [...s.workingTreeChanges, ...(s.untrackedChanges ?? [])].map(raw));
  }

  /** Text of a file on one side of a diff; empty if it doesn't exist there. */
  async readSide(relPath: string, d: DiffSide): Promise<string> {
    const ref = gitRefFor(d);
    try {
      return ref === undefined ? await fs.readFile(this.abs(relPath), 'utf8') : await this.repo.show(ref, this.abs(relPath));
    } catch {
      return '';
    }
  }

  async author(): Promise<string> {
    try {
      const name = (await this.repo.getConfig('user.name')).trim();
      if (name) {
        return name;
      }
    } catch {
      // fall through
    }
    return os.userInfo().username;
  }

  /** Absolute hooks directory (honours core.hooksPath, e.g. Husky). */
  async hooksDir(): Promise<string> {
    const out = (await this.run(['rev-parse', '--git-path', 'hooks'])).trim();
    return path.resolve(this.root, out);
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.api.git.path, args, { cwd: this.root, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
  }
}
