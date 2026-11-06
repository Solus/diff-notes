import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { DiffSide, gitRefFor } from './core/diffRef';
import { ChangedFile, CommitInfo, LOG_FORMAT, mergeWorkingChanges, parseLog, parseNameStatusZ, RawChange } from './core/gitParse';
import { API, Change, Repository } from './gitApi';

const MAX_COMMITS = 200;

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
    const head = this.repo.state.HEAD;
    if (!head?.commit) {
      return [];
    }
    const range = head.upstream ? ['@{upstream}..HEAD'] : ['HEAD', '--not', '--remotes'];
    try {
      return parseLog(await this.run(['log', LOG_FORMAT, `-n${MAX_COMMITS}`, ...range]));
    } catch {
      return [];
    }
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

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.api.git.path, args, { cwd: this.root, maxBuffer: 64 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
    });
  }
}
