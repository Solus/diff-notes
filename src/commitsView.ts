import * as path from 'path';
import * as vscode from 'vscode';
import { ChangedFile, CommitInfo } from './core/gitParse';
import { WORKING_TREE } from './core/model';
import { joinParts, noteCount } from './core/rowText';
import { CommentStore } from './core/store';
import { GitService } from './git';

type Node =
  | { kind: 'worktree' }
  | { kind: 'commit'; commit: CommitInfo }
  | { kind: 'file'; origin: string; originLabel: string; file: ChangedFile };

const STATUS_TEXT: Record<ChangedFile['status'], string> = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type changed',
};

/** Commits TreeView: Working tree, then unpushed commits (newest first), each expanding to files. */
export class CommitsProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private git: GitService | undefined;

  private store: CommentStore | undefined;

  setStore(store: CommentStore): void {
    this.store = store;
  }

  /** Open, non-outdated comments on a commit / the working tree, optionally for one file. */
  private openCount(origin: string, f?: ChangedFile): number {
    return (this.store?.all() ?? []).filter(c => c.origin === origin && !c.outdated && c.status === 'open' && (!f || c.file === (c.side === 'new' ? f.path : (f.oldPath ?? f.path)))).length;
  }

  setGit(git: GitService): void {
    this.git = git;
    this.refresh();
  }

  refresh(): void {
    this.changed.fire();
  }

  async getChildren(node?: Node): Promise<Node[]> {
    const git = this.git;
    if (!git) {
      return [];
    }
    if (!node) {
      const commits = await git.unpushedCommits();
      return [{ kind: 'worktree' }, ...commits.map(commit => ({ kind: 'commit' as const, commit }))];
    }
    if (node.kind === 'worktree') {
      return git.workingTreeFiles().map(file => ({ kind: 'file', origin: WORKING_TREE, originLabel: 'Working Tree', file }));
    }
    if (node.kind === 'commit') {
      const files = await git.commitFiles(node.commit.sha);
      return files.map(file => ({ kind: 'file', origin: node.commit.sha, originLabel: node.commit.shortSha, file }));
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    switch (node.kind) {
      case 'worktree': {
        const n = this.git?.workingTreeFiles().length ?? 0;
        const item = new vscode.TreeItem('Working tree', vscode.TreeItemCollapsibleState.Expanded);
        item.description = joinParts(n === 0 ? 'no changes' : `${n} file${n === 1 ? '' : 's'}`, noteCount(this.openCount(WORKING_TREE)));
        item.iconPath = new vscode.ThemeIcon('edit');
        item.contextValue = 'worktree';
        return item;
      }
      case 'commit': {
        const c = node.commit;
        const item = new vscode.TreeItem(c.subject, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = joinParts(c.shortSha, noteCount(this.openCount(c.sha)));
        item.tooltip = `${c.shortSha} · ${c.author} · ${new Date(c.date).toLocaleString()}\n\n${c.subject}`;
        item.iconPath = new vscode.ThemeIcon('git-commit');
        item.contextValue = 'commit';
        return item;
      }
      case 'file': {
        const f = node.file;
        const item = new vscode.TreeItem(path.posix.basename(f.path), vscode.TreeItemCollapsibleState.None);
        const dir = path.posix.dirname(f.path);
        item.description = joinParts(dir === '.' ? '' : dir, noteCount(this.openCount(node.origin, f)));
        item.tooltip = `${f.oldPath ? `${f.oldPath} → ` : ''}${f.path} · ${STATUS_TEXT[f.status]}`;
        if (this.git) {
          item.resourceUri = vscode.Uri.file(this.git.abs(f.path));
        }
        item.contextValue = 'file';
        item.command = { command: 'diffNotes.openDiff', title: 'Open Diff', arguments: [node.origin, node.originLabel, f] };
        return item;
      }
    }
  }

  dispose(): void {
    this.changed.dispose();
  }
}
