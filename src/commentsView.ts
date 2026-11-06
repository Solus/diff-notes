import * as path from 'path';
import * as vscode from 'vscode';
import { CommentGroup, filterComments, groupComments, GroupMode, sortComments } from './core/commentList';
import { rangeLabel, StoredComment, WORKING_TREE } from './core/model';
import { CommentStore } from './core/store';
import { GitService } from './git';

type Node = { kind: 'group'; group: CommentGroup; label: string } | { kind: 'comment'; comment: StoredComment; showCommit: boolean };

export const GROUP_LABELS: Record<GroupMode, string> = { commit: 'Commit', file: 'File', none: 'None' };

/** Comments TreeView: grouped by commit / file / none, optionally open-only. */
export class CommentsProvider implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private git: GitService | undefined;
  private subjects = new Map<string, string>();
  mode: GroupMode = 'commit';
  openOnly = true;

  constructor(private readonly store: CommentStore) {}

  setGit(git: GitService): void {
    this.git = git;
    this.refresh();
  }

  refresh(): void {
    this.changed.fire();
  }

  async getChildren(node?: Node): Promise<Node[]> {
    if (node) {
      return node.kind === 'group' ? node.group.comments.map(comment => ({ kind: 'comment', comment, showCommit: this.mode !== 'commit' || node.group.kind === 'outdated' })) : [];
    }
    if (!this.git) {
      return [];
    }
    const commits = await this.git.unpushedCommits();
    this.subjects = new Map(commits.map(c => [c.sha, `${c.shortSha} ${c.subject}`]));
    const order = commits.map(c => c.sha);
    const comments = filterComments(this.store.all(), this.openOnly);
    if (this.mode === 'none') {
      const flat: Node[] = sortComments(comments.filter(c => !c.outdated), order).map(comment => ({ kind: 'comment', comment, showCommit: true }));
      return [...flat, ...groupComments(comments, 'none', order).map(group => ({ kind: 'group' as const, group, label: this.groupLabel(group) }))];
    }
    return groupComments(comments, this.mode, order).map(group => ({ kind: 'group', group, label: this.groupLabel(group) }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'group') {
      const g = node.group;
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(g.comments.length);
      item.iconPath = new vscode.ThemeIcon(g.kind === 'worktree' ? 'edit' : g.kind === 'file' ? 'file' : g.kind === 'outdated' ? 'history' : 'git-commit');
      item.contextValue = 'commentGroup';
      return item;
    }
    const c = node.comment;
    const first = c.body.split(/\r?\n/).find(l => l.trim()) ?? '(empty)';
    const item = new vscode.TreeItem(first.trim(), vscode.TreeItemCollapsibleState.None);
    const where = `${path.posix.basename(c.file)} · ${rangeLabel(c)}`;
    item.description = node.showCommit ? `${where} · ${this.originLabel(c.origin)}` : where;
    item.tooltip = `${c.file} · ${rangeLabel(c)}\n${this.originLabel(c.origin)} · ${c.status}\n\n${c.body}`;
    item.iconPath = new vscode.ThemeIcon(c.status === 'resolved' ? 'check' : c.outdated ? 'warning' : 'comment');
    item.contextValue = c.status;
    item.command = { command: 'diffNotes.openComment', title: 'Open Comment', arguments: [c.id] };
    return item;
  }

  dispose(): void {
    this.changed.dispose();
  }

  private originLabel(origin: string): string {
    return origin === WORKING_TREE ? 'Working tree' : (this.subjects.get(origin)?.split(' ')[0] ?? origin.slice(0, 7));
  }

  private groupLabel(g: CommentGroup): string {
    switch (g.kind) {
      case 'worktree':
        return 'Working tree';
      case 'commit':
        return this.subjects.get(g.key) ?? g.key.slice(0, 7);
      case 'other':
        return `${g.key.slice(0, 7)} (not in unpushed list)`;
      case 'file':
        return g.key;
      case 'outdated':
        return 'Outdated';
    }
  }
}
