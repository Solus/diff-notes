import * as path from 'path';
import * as vscode from 'vscode';
import { CommentGroup, GroupMode, visibleList } from './core/commentList';
import { MdSection, shortOrigin } from './core/markdown';
import { rangeLabel, StoredComment, WORKING_TREE } from './core/model';
import { CommentStore } from './core/store';
import { GitService } from './git';

export type Node = { kind: 'group'; group: CommentGroup; label: string } | { kind: 'comment'; comment: StoredComment; showCommit: boolean };

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
      return node.kind === 'group' ? node.group.comments.map(comment => ({ kind: 'comment', comment, showCommit: this.mode !== 'commit' || node.group.kind === 'outdated' || node.group.kind === 'pushed' })) : [];
    }
    if (!this.git) {
      return [];
    }
    const { order } = await this.load();
    const { loose, groups } = visibleList(this.store.all(), this.openOnly, this.mode, order);
    return [
      ...loose.map(comment => ({ kind: 'comment' as const, comment, showCommit: true })),
      ...groups.map(group => ({ kind: 'group' as const, group, label: this.groupLabel(group) })),
    ];
  }

  private async load(): Promise<{ order: string[] }> {
    const commits = this.git ? await this.git.unpushedCommits() : [];
    this.subjects = new Map(commits.map(c => [c.sha, `${c.shortSha} ${c.subject}`]));
    return { order: commits.map(c => c.sha) };
  }

  /** What the list shows now, as markdown sections (loose notes first, then groups). Also returns the commit labeller. */
  async sections(): Promise<{ sections: MdSection[]; commitLabel: (origin: string) => string }> {
    const { order } = await this.load();
    const { loose, groups } = visibleList(this.store.all(), this.openOnly, this.mode, order);
    const sections: MdSection[] = [{ notes: loose }, ...groups.map(g => ({ heading: this.groupLabel(g), notes: g.comments }))];
    return { sections, commitLabel: await this.labeller(sections.flatMap(s => s.notes.map(n => n.origin))) };
  }

  /** Commit label function (`abc1234 subject`) for the given origins; looks up commits outside the unpushed list. */
  async labeller(origins: string[]): Promise<(origin: string) => string> {
    for (const o of new Set(origins)) {
      if (o !== WORKING_TREE && !this.subjects.has(o) && this.git) {
        const l = await this.git.commitLabel(o);
        if (l) {
          this.subjects.set(o, l);
        }
      }
    }
    return o => (o === WORKING_TREE ? 'Working tree' : (this.subjects.get(o) ?? shortOrigin(o)));
  }

  /** Same as `sections` for one group row or one note row. */
  async sectionsFor(node: Node): Promise<{ sections: MdSection[]; commitLabel: (origin: string) => string }> {
    await this.load();
    const sections: MdSection[] = node.kind === 'group' ? [{ heading: node.label, notes: node.group.comments }] : [{ notes: [node.comment] }];
    return { sections, commitLabel: await this.labeller(sections.flatMap(s => s.notes.map(n => n.origin))) };
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'group') {
      const g = node.group;
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(g.comments.length);
      item.iconPath = new vscode.ThemeIcon(g.kind === 'worktree' ? 'edit' : g.kind === 'file' ? 'file' : g.kind === 'outdated' ? 'history' : g.kind === 'pushed' ? 'repo-pushed' : 'git-commit');
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
      case 'pushed':
        return 'PUSHED';
      case 'file':
        return g.key;
      case 'outdated':
        return 'Outdated';
    }
  }
}
