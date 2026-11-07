import * as path from 'path';
import * as vscode from 'vscode';
import { Anchoring } from './anchoring';
import { NotesController, OutdatedContentProvider } from './comments';
import { CommentsProvider, GROUP_LABELS } from './commentsView';
import { CommitsProvider } from './commitsView';
import { DiffContentProvider } from './contentProvider';
import { OUTDATED_SCHEME, SCHEME } from './core/diffRef';
import { countOpenUnpushed, GroupMode } from './core/commentList';
import { ChangedFile } from './core/gitParse';
import { CommentStore } from './core/store';
import { StoredComment, WORKING_TREE } from './core/model';
import { findOpenLine } from './core/openLine';
import { diffUri } from './diffUri';
import { GitService } from './git';
import { Markers } from './markers';
import { HookManager } from './hook';
import { API, GitExtension, Repository } from './gitApi';
import { NotesFileIO, resolveGitDir } from './storage';

const GROUP_KEY = 'diffNotes.groupBy';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const commits = new CommitsProvider();
  ctx.subscriptions.push(commits, vscode.window.registerTreeDataProvider('diffNotes.commits', commits));

  const gitExt = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExt) {
    return;
  }
  const exports = gitExt.isActive ? gitExt.exports : await gitExt.activate();
  if (!exports.enabled) {
    return;
  }
  const api = exports.getAPI(1);
  // Never block activation on a repository: with none open this would hang forever (endless progress bar).
  // The empty tree shows the "No Git repository" welcome text until one opens.
  void whenRepository(api, ctx, repo => start(ctx, commits, api, repo));
}

async function start(ctx: vscode.ExtensionContext, commits: CommitsProvider, api: API, repo: Repository): Promise<void> {
  const git = new GitService(api, repo);

  const io = new NotesFileIO(await resolveGitDir(git.root));
  const store = new CommentStore();
  let canSave = true;
  try {
    store.load(await io.read());
  } catch (e) {
    canSave = false; // never overwrite a file we couldn't read
    void vscode.window.showErrorMessage(`Diff Notes: could not read ${io.file} (${(e as Error).message}). Notes will not be saved this session.`);
  }
  commits.setStore(store);
  const commentsView = new CommentsProvider(store);
  const savedMode = ctx.workspaceState.get<string>(GROUP_KEY);
  if (savedMode && savedMode in GROUP_LABELS) {
    commentsView.mode = savedMode as GroupMode; // remembered per workspace
  }
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  bar.command = 'diffNotes.comments.focus';
  const updateBar = async (): Promise<void> => {
    const n = countOpenUnpushed(store.all(), (await git.unpushedCommits()).map(c => c.sha));
    bar.text = `$(comment) ${n}`;
    bar.tooltip = `Diff Notes: ${n} open comment${n === 1 ? '' : 's'} on unpushed commits and working tree`;
  };
  const markers = new Markers(store, ctx);
  ctx.subscriptions.push(markers);
  const refreshComments = (): void => {
    markers.refresh();
    commentsView.refresh();
    commits.refresh();
    void updateBar();
  };
  const gitDir = await resolveGitDir(git.root);
  const hook = new HookManager(await git.hooksDir().catch(() => path.join(gitDir, 'hooks')), gitDir);
  const writeSummary = (): Promise<void> => hook.writeSummary(store.all()).catch(() => undefined);
  const persist = async (): Promise<void> => {
    refreshComments();
    if (!canSave) {
      return;
    }
    try {
      await io.write(store.serialize());
      await writeSummary();
    } catch (e) {
      void vscode.window.showErrorMessage(`Diff Notes: could not save notes (${(e as Error).message}).`);
    }
  };

  const applyHookSetting = async (): Promise<void> => {
    const on = vscode.workspace.getConfiguration('diffNotes').get<boolean>('prePushHook', false);
    try {
      if (on) {
        await writeSummary();
        if ((await hook.install()) === 'chained') {
          void vscode.window.showInformationMessage('Diff Notes: your existing pre-push hook was kept and will run first.');
        }
      } else {
        await hook.uninstall();
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`Diff Notes: could not update the pre-push hook (${(e as Error).message}).`);
    }
  };
  void applyHookSetting();
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('diffNotes.prePushHook')) {
        void applyHookSetting();
      }
    }),
  );

  const content = new DiffContentProvider(git);
  const notes = new NotesController(store, git, persist);
  ctx.subscriptions.push(
    content,
    notes,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, content),
    vscode.workspace.registerTextDocumentContentProvider(OUTDATED_SCHEME, new OutdatedContentProvider(store)),
  );
  notes.restoreAll();
  const anchoring = new Anchoring(store, git, async changed => {
    changed.forEach(c => notes.sync(c));
    markers.refresh();
    content.refreshWorkingTree();
    await persist();
  });
  void anchoring.run();
  commits.setGit(git);
  commentsView.setGit(git);
  const setCtx = (): unknown => vscode.commands.executeCommand('setContext', 'diffNotes.openOnly', commentsView.openOnly);
  void setCtx();
  bar.show();
  void updateBar();
  ctx.subscriptions.push(commentsView, bar, vscode.window.createTreeView('diffNotes.comments', { treeDataProvider: commentsView }));

  let timer: NodeJS.Timeout | undefined;
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      commits.refresh();
      refreshComments();
      content.refreshWorkingTree();
      void anchoring.run();
    }, 300);
  };
  ctx.subscriptions.push(git.onDidChange(schedule), vscode.workspace.onDidSaveTextDocument(schedule), { dispose: () => clearTimeout(timer) });

  const reg = (id: string, fn: (...args: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('diffNotes.refresh', () => commits.refresh());
  reg('diffNotes.openDiff', (origin: string, originLabel: string, file: ChangedFile) => {
    const left = diffUri({ file: file.oldPath ?? file.path, origin, side: 'old' });
    const right = diffUri({ file: file.path, origin, side: 'new' });
    return vscode.commands.executeCommand('vscode.diff', left, right, `${path.posix.basename(file.path)} (${originLabel})`);
  });
  reg('diffNotes.openOnly', () => {
    commentsView.openOnly = true;
    void setCtx();
    commentsView.refresh();
  });
  reg('diffNotes.showAll', () => {
    commentsView.openOnly = false;
    void setCtx();
    commentsView.refresh();
  });
  reg('diffNotes.groupBy', async () => {
    const items = (Object.keys(GROUP_LABELS) as GroupMode[]).map(m => ({
      label: GROUP_LABELS[m],
      description: m === commentsView.mode ? 'current' : undefined,
      mode: m,
    }));
    const pick = await vscode.window.showQuickPick(items, { title: 'Group comments by' });
    if (pick) {
      commentsView.mode = pick.mode;
      void ctx.workspaceState.update(GROUP_KEY, pick.mode);
      commentsView.refresh();
    }
  });
  const openDiffFor = async (c: StoredComment): Promise<void> => {
    const files = c.origin === WORKING_TREE ? git.workingTreeFiles() : await git.commitFiles(c.origin).catch(() => []);
    const f = files.find(x => (c.side === 'new' ? x.path : (x.oldPath ?? x.path)) === c.file);
    const newPath = c.side === 'new' ? c.file : (f?.path ?? c.file);
    const oldPath = c.side === 'old' ? c.file : (f?.oldPath ?? c.file);
    const label = c.origin === WORKING_TREE ? 'Working Tree' : c.origin.slice(0, 7);
    await vscode.commands.executeCommand(
      'vscode.diff',
      diffUri({ file: oldPath, origin: c.origin, side: 'old' }),
      diffUri({ file: newPath, origin: c.origin, side: 'new' }),
      `${path.posix.basename(newPath)} (${label})`,
      { selection: new vscode.Range(c.startLine - 1, 0, c.startLine - 1, 0) },
    );
    notes.expand(c.id);
  };
  reg('diffNotes.openComment', async (id: string) => {
    const c = store.get(id);
    if (!c) {
      return;
    }
    if (c.outdated) {
      const { uri, range } = notes.openOutdatedThread(c);
      const start = range.start;
      await vscode.window.showTextDocument(uri, { selection: new vscode.Range(start, start), preview: true });
      notes.expand(c.id);
      return;
    }
    await openDiffFor(c);
  });
  reg('diffNotes.openCurrentDiff', async (t: vscode.CommentThread) => {
    const c = store.get(notes.idOf(t) ?? '');
    if (c) {
      await openDiffFor(c);
    }
  });
  reg('diffNotes.openFile', async (arg: vscode.CommentThread | { comment?: StoredComment } | string) => {
    const c = typeof arg === 'string' ? store.get(arg) : 'comment' in arg && arg.comment ? arg.comment : store.get(notes.idOf(arg as vscode.CommentThread) ?? '');
    if (!c) {
      return;
    }
    const uri = vscode.Uri.file(path.join(git.root, ...c.file.split('/')));
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      void vscode.window.showInformationMessage(`Diff Notes: ${c.file} no longer exists in the working tree.`);
      return;
    }
    const { line, found } = findOpenLine(c.snippet, c.startLine, text);
    const pos = new vscode.Position(line, 0);
    await vscode.window.showTextDocument(uri, { selection: new vscode.Range(pos, pos), preview: false });
    if (!found) {
      vscode.window.setStatusBarMessage("Diff Notes: Note's code not found in current file — opened at stored line", 5000);
    }
  });
  reg('diffNotes.createComment', (r: vscode.CommentReply) => notes.create(r));
  reg('diffNotes.reply', (r: vscode.CommentReply) => notes.reply(r));
  reg('diffNotes.cancelDraft', (r: vscode.CommentReply | vscode.CommentThread) => notes.cancelDraft(r));
  reg('diffNotes.editComment', c => notes.startEdit(c));
  reg('diffNotes.saveComment', c => notes.saveEdit(c));
  reg('diffNotes.cancelEdit', c => notes.cancelEdit(c));
  reg('diffNotes.resolve', (t: vscode.CommentThread) => notes.setStatus(t, 'resolved'));
  reg('diffNotes.reopen', (t: vscode.CommentThread) => notes.setStatus(t, 'open'));
}

/** Calls `cb` once with the first repository the git extension opens (single-repo for now), now or later. */
async function whenRepository(api: API, ctx: vscode.ExtensionContext, cb: (r: Repository) => Promise<void>): Promise<void> {
  let done = false;
  const take = (r: Repository): void => {
    if (!done) {
      done = true;
      void cb(r);
    }
  };
  ctx.subscriptions.push(api.onDidOpenRepository(take));
  if (api.repositories.length > 0) {
    take(api.repositories[0]);
  }
}

export function deactivate(): void {}
