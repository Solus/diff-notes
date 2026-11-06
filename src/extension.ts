import * as path from 'path';
import * as vscode from 'vscode';
import { NotesController } from './comments';
import { CommitsProvider } from './commitsView';
import { DiffContentProvider } from './contentProvider';
import { SCHEME } from './core/diffRef';
import { ChangedFile } from './core/gitParse';
import { CommentStore } from './core/store';
import { diffUri } from './diffUri';
import { GitService } from './git';
import { API, GitExtension, Repository } from './gitApi';
import { NotesFileIO, resolveGitDir } from './storage';

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
  const persist = async (): Promise<void> => {
    if (!canSave) {
      return;
    }
    try {
      await io.write(store.serialize());
    } catch (e) {
      void vscode.window.showErrorMessage(`Diff Notes: could not save notes (${(e as Error).message}).`);
    }
  };

  const content = new DiffContentProvider(git);
  const notes = new NotesController(store, git, persist);
  ctx.subscriptions.push(content, notes, vscode.workspace.registerTextDocumentContentProvider(SCHEME, content));
  notes.restoreAll();
  commits.setGit(git);

  let timer: NodeJS.Timeout | undefined;
  ctx.subscriptions.push(
    git.onDidChange(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        commits.refresh();
        content.refreshWorkingTree();
      }, 300);
    }),
    { dispose: () => clearTimeout(timer) },
  );

  const reg = (id: string, fn: (...args: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('diffNotes.refresh', () => commits.refresh());
  reg('diffNotes.openDiff', (origin: string, originLabel: string, file: ChangedFile) => {
    const left = diffUri({ file: file.oldPath ?? file.path, origin, side: 'old' });
    const right = diffUri({ file: file.path, origin, side: 'new' });
    return vscode.commands.executeCommand('vscode.diff', left, right, `${path.posix.basename(file.path)} (${originLabel})`);
  });
  reg('diffNotes.createComment', (r: vscode.CommentReply) => notes.create(r));
  reg('diffNotes.reply', (r: vscode.CommentReply) => notes.reply(r));
  reg('diffNotes.cancelDraft', (t: vscode.CommentThread) => notes.cancelDraft(t));
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
