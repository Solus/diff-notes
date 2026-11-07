import * as vscode from 'vscode';
import { CommentGroup, GroupMode, visibleList } from './core/commentList';
import { MdSection, shortOrigin } from './core/markdown';
import { RowGroup, rowDescription, rowLabel, tooltipMarkdown } from './core/rowText';
import { StoredComment, WORKING_TREE } from './core/model';
import { CommentStore } from './core/store';
import { GitService } from './git';

export type Node = { kind: 'group'; group: CommentGroup; label: string; nested?: boolean } | { kind: 'comment'; comment: StoredComment; group: RowGroup };

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
      if (node.kind !== 'group') {
        return [];
      }
      if (node.group.files) {
        return node.group.files.map(group => ({ kind: 'group' as const, group, label: this.groupLabel(group), nested: true }));
      }
      return node.group.comments.map(comment => ({ kind: 'comment' as const, comment, group: node.nested ? ('nested' as const) : node.group.kind }));
    }
    if (!this.git) {
      return [];
    }
    const { order } = await this.load();
    const { loose, groups } = visibleList(this.store.all(), this.openOnly, this.mode, order);
    return [
      ...loose.map(comment => ({ kind: 'comment' as const, comment, group: undefined })),
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
    const sections: MdSection[] = [{ notes: loose }, ...groups.map(g => this.section(g))];
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
    const sections: MdSection[] = node.kind === 'group' ? [this.section(node.group)] : [{ notes: [node.comment] }];
    return { sections, commitLabel: await this.labeller(sections.flatMap(s => s.notes.map(n => n.origin))) };
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'group') {
      const g = node.group;
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.description = String(g.comments.length);
      switch (g.kind) {
        case 'worktree':
          item.iconPath = new vscode.ThemeIcon('edit');
          break;
        case 'commit':
          item.iconPath = new vscode.ThemeIcon('git-commit');
          item.tooltip = this.subjects.get(g.key) ?? g.key;
          break;
        case 'file':
          item.iconPath = vscode.ThemeIcon.File;
          item.resourceUri = this.git ? vscode.Uri.file(this.git.abs(g.key)) : undefined;
          item.tooltip = g.key;
          break;
        case 'pushed':
          item.iconPath = new vscode.ThemeIcon('cloud-upload');
          break;
        case 'outdated':
          item.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
          break;
      }
      item.contextValue = 'commentGroup';
      return item;
    }
    const c = node.comment;
    const item = new vscode.TreeItem(rowLabel(c.body),vscode.TreeItemCollapsibleState.None);
    item.description = rowDescription(node.group, c, this.originLabel(c.origin));
    const tip = new vscode.MarkdownString(tooltipMarkdown(c, c.origin === WORKING_TREE ? 'Working tree' : (this.subjects.get(c.origin) ?? shortOrigin(c.origin)), Date.now()));
    tip.supportThemeIcons = true;
    tip.supportHtml = true;
    item.tooltip = tip;
    item.iconPath = this.noteIcon(c, node.group);
    item.contextValue = c.status;
    item.command = { command: 'diffNotes.openComment', title: 'Open Comment', arguments: [c.id] };
    return item;
  }

  dispose(): void {
    this.changed.dispose();
  }

  private noteIcon(c: StoredComment, group: RowGroup): vscode.ThemeIcon {
    if (c.outdated) {
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    }
    if (group === 'pushed' || group === 'nested' || (group === undefined && this.isPushed(c))) {
      return new vscode.ThemeIcon('cloud-upload');
    }
    return c.status === 'resolved' ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed')) : new vscode.ThemeIcon('comment');
  }

  private isPushed(c: StoredComment): boolean {
    return c.origin !== WORKING_TREE && !this.subjects.has(c.origin);
  }

  private section(g: CommentGroup): MdSection {
    return { heading: this.groupLabel(g, true), notes: g.comments, subsections: g.files?.map(f => this.section(f)) };
  }

  private originLabel(origin: string): string {
    return origin === WORKING_TREE ? 'Working tree' : (this.subjects.get(origin)?.split(' ')[0] ?? origin.slice(0, 7));
  }

  /** Tree label of a group: commit groups show just the subject; markdown headings keep `sha subject`. */
  private groupLabel(g: CommentGroup, withSha = false): string {
    switch (g.kind) {
      case 'worktree':
        return 'Working tree';
      case 'commit':
      {
        const full = this.subjects.get(g.key);
        return full ? (withSha ? full : full.slice(full.indexOf(' ') + 1)) : g.key.slice(0, 7);
      }
      case 'pushed':
        return 'Pushed';
      case 'file':
        return g.key;
      case 'outdated':
        return 'Outdated';
    }
  }
}
