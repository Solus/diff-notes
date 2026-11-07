import * as path from 'path';
import * as vscode from 'vscode';
import { Anchoring } from './anchoring';
import { NoteComment, NotesController, OutdatedContentProvider } from './comments';
import { CommentsProvider, GROUP_LABELS, Node as ListNode } from './commentsView';
import { CommitsProvider } from './commitsView';
import { DiffContentProvider } from './contentProvider';
import { OUTDATED_SCHEME, SCHEME } from './core/diffRef';
import { deletePrompt, expiredPushed, outdatedNotes, pushedNotes, resolvedNotes, stampPushed } from './core/cleanup';
import { countOpenUnpushed, GroupMode } from './core/commentList';
import { ChangedFile } from './core/gitParse';
import { CommentStore } from './core/store';
import { StoredComment, WORKING_TREE } from './core/model';
import { findOpenLine } from './core/openLine';
import { pickNote } from './core/noteNav';
import { countNotes, notesToMarkdown } from './core/markdown';
import { diffUri, parseDiffUri } from './diffUri';
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

  let sweepPushedLater: () => Promise<void> = async () => undefined;
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
      if (e.affectsConfiguration('diffNotes.autoClearPushedDays')) {
        void sweepPushedLater();
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
  const deleteNotes = async (ids: string[]): Promise<void> => {
    if (store.remove(ids) > 0) {
      ids.forEach(id => notes.remove(id));
      await persist();
    }
  };
  /** Stamp newly pushed notes and auto-delete old pushed ones. Skipped when the unpushed list is unknown. */
  const sweepPushed = async (): Promise<void> => {
    const list = await git.tryUnpushed();
    if (!list) {
      return;
    }
    const shas = list.map(c => c.sha);
    const stamped = stampPushed(store.all(), shas, new Date().toISOString());
    const days = vscode.workspace.getConfiguration('diffNotes').get<number>('autoClearPushedDays', 0);
    const expired = expiredPushed(store.all(), shas, days, Date.now()).map(c => c.id);
    if (expired.length) {
      await deleteNotes(expired);
    } else if (stamped) {
      await persist();
    }
  };
  sweepPushedLater = sweepPushed;
  const runAnchoring = (): Promise<void> => anchoring.run().then(sweepPushed);
  void runAnchoring();
  commits.setGit(git);
  commentsView.setGit(git);
  const setCtx = (): unknown => vscode.commands.executeCommand('setContext', 'diffNotes.openOnly', commentsView.openOnly);
  void setCtx();
  void vscode.commands.executeCommand('setContext', 'diffNotes.groupMode', commentsView.mode);
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
      void runAnchoring();
    }, 300);
  };
  ctx.subscriptions.push(git.onDidChange(schedule), vscode.workspace.onDidSaveTextDocument(schedule), { dispose: () => clearTimeout(timer) });

  const reg = (id: string, fn: (...args: any[]) => unknown) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('diffNotes.refresh', () => commits.refresh());
  /** Open (not resolved, not outdated) notes whose thread sits on one of these diff document URIs. */
  const openNotesIn = (uris: string[]): StoredComment[] =>
    store.all().filter(c => !c.outdated && c.status === 'open' && uris.includes(diffUri({ file: c.file, origin: c.origin, side: c.side }).toString()));
  /** Both document URIs of the diff in the active tab, if it is one of ours. */
  const currentDiffUris = (): string[] | undefined => {
    const i = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return i instanceof vscode.TabInputTextDiff && parseDiffUri(i.modified) ? [i.original.toString(), i.modified.toString()] : undefined;
  };
  const findEditor = async (uri: string): Promise<vscode.TextEditor | undefined> => {
    for (let i = 0; i < 20; i++) {
      const ed = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri);
      if (ed) {
        return ed;
      }
      await new Promise(r => setTimeout(r, 50));
    }
    return undefined;
  };
  /** Focus the note's side, put the cursor (no selection) on its first line, reveal it, expand only its box. */
  const goToNote = async (c: StoredComment, diffUris: string[]): Promise<boolean> => {
    const target = diffUri({ file: c.file, origin: c.origin, side: c.side }).toString();
    const ed = await findEditor(target);
    if (!ed) {
      return false;
    }
    const active = vscode.window.activeTextEditor;
    if (active && active !== ed && diffUris.includes(active.document.uri.toString())) {
      await Promise.resolve(vscode.commands.executeCommand('workbench.action.compareEditor.focusOtherSide')).then(undefined, () => undefined);
    }
    const pos = new vscode.Position(c.startLine - 1, 0);
    ed.selection = new vscode.Selection(pos, pos);
    ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    notes.focusOnly(openNotesIn(diffUris).map(x => x.id), c.id);
    return true;
  };
  const stepNote = async (dir: 1 | -1): Promise<void> => {
    const uris = currentDiffUris();
    if (!uris) {
      return;
    }
    const ed = vscode.window.activeTextEditor;
    const d = ed && uris.includes(ed.document.uri.toString()) ? parseDiffUri(ed.document.uri) : undefined;
    const cursor = ed && d ? { side: d.side, line: ed.selection.active.line + 1 } : undefined;
    const { note, wrapped } = pickNote(openNotesIn(uris), cursor, dir);
    if (!note) {
      vscode.window.setStatusBarMessage('Diff Notes: no open notes in this diff', 3000);
      return;
    }
    await goToNote(note, uris);
    if (wrapped) {
      vscode.window.setStatusBarMessage(dir === 1 ? 'Diff Notes: wrapped to first note' : 'Diff Notes: wrapped to last note', 3000);
    }
  };
  reg('diffNotes.nextNote', () => stepNote(1));
  reg('diffNotes.previousNote', () => stepNote(-1));
  reg('diffNotes.openDiff', async (origin: string, originLabel: string, file: ChangedFile) => {
    const left = diffUri({ file: file.oldPath ?? file.path, origin, side: 'old' });
    const right = diffUri({ file: file.path, origin, side: 'new' });
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.posix.basename(file.path)} (${originLabel})`);
    // Without this, VS Code only scrolls to a note when the diff happens to hold exactly one.
    const first = pickNote(openNotesIn([left.toString(), right.toString()]), undefined, 1).note;
    if (first) {
      await goToNote(first, [left.toString(), right.toString()]);
    }
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
  const setMode = (m: GroupMode): void => {
    commentsView.mode = m;
    void vscode.commands.executeCommand('setContext', 'diffNotes.groupMode', m);
    void ctx.workspaceState.update(GROUP_KEY, m);
    commentsView.refresh();
  };
  reg('diffNotes.groupByCommit', () => setMode('commit'));
  reg('diffNotes.groupByFile', () => setMode('file'));
  reg('diffNotes.groupByNone', () => setMode('none'));
  const openDiffFor = async (c: StoredComment): Promise<void> => {
    const files = c.origin === WORKING_TREE ? git.workingTreeFiles() : await git.commitFiles(c.origin).catch(() => []);
    const f = files.find(x => (c.side === 'new' ? x.path : (x.oldPath ?? x.path)) === c.file);
    const newPath = c.side === 'new' ? c.file : (f?.path ?? c.file);
    const oldPath = c.side === 'old' ? c.file : (f?.oldPath ?? c.file);
    const label = c.origin === WORKING_TREE ? 'Working Tree' : c.origin.slice(0, 7);
    const left = diffUri({ file: oldPath, origin: c.origin, side: 'old' });
    const right = diffUri({ file: newPath, origin: c.origin, side: 'new' });
    await vscode.commands.executeCommand('vscode.diff', left, right, `${path.posix.basename(newPath)} (${label})`);
    if (!(await goToNote(c, [left.toString(), right.toString()]))) {
      notes.expand(c.id);
    }
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
  /** Opens the working-tree file; `pick` chooses the 0-based line from its text. Missing file -> info message. */
  /** Follows renames up to the working tree: base is the commit (new side) or its parent / HEAD (old side). */
  const resolveCurrent = async (file: string, origin: string, side: 'old' | 'new'): Promise<string> => {
    if (side === 'new' && origin === WORKING_TREE) {
      return file;
    }
    const base = origin === WORKING_TREE ? 'HEAD' : side === 'old' ? `${origin}^` : origin;
    return (await git.currentPath(base, file)).path;
  };
  const openWorking = async (file: string, pick: (text: string) => { line: number; found: boolean }, miss: string): Promise<void> => {
    const uri = vscode.Uri.file(path.join(git.root, ...file.split('/')));
    let text: string;
    try {
      text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    } catch {
      void vscode.window.showInformationMessage(`Diff Notes: ${file} no longer exists in the working tree.`);
      return;
    }
    const { line, found } = pick(text);
    const pos = new vscode.Position(line, 0);
    await vscode.window.showTextDocument(uri, { selection: new vscode.Range(pos, pos), preview: false });
    if (!found) {
      vscode.window.setStatusBarMessage(miss, 5000);
    }
  };
  reg('diffNotes.openFile', async (arg: vscode.CommentThread | { comment?: StoredComment } | string) => {
    const c = typeof arg === 'string' ? store.get(arg) : 'comment' in arg && arg.comment ? arg.comment : store.get(notes.idOf(arg as vscode.CommentThread) ?? '');
    if (c) {
      await openWorking(await resolveCurrent(c.file, c.origin, c.side), text => findOpenLine(c.snippet, c.startLine, text), "Diff Notes: Note's code not found in current file — opened at stored line");
    }
  });
  reg('diffNotes.openDiffFile', async () => {
    const ed = vscode.window.activeTextEditor;
    const d = ed && parseDiffUri(ed.document.uri);
    if (!ed || !d) {
      return;
    }
    const doc = ed.document;
    const cur = ed.selection.active.line;
    const grab = (from: number, to: number): string[] => {
      const out: string[] = [];
      for (let i = Math.max(0, from); i < Math.min(doc.lineCount, to); i++) {
        out.push(doc.lineAt(i).text);
      }
      return out;
    };
    const snippet = { before: grab(cur - 3, cur), lines: grab(cur, cur + 1), after: grab(cur + 1, cur + 4) };
    await openWorking(await resolveCurrent(d.file, d.origin, d.side), text => findOpenLine(snippet, cur + 1, text), 'Diff Notes: Cursor line not found in current file — opened at same line number');
  });
  reg('diffNotes.openCommitFile', async (node: { file?: ChangedFile }) => {
    if (node?.file) {
      await openWorking(node.file.path, () => ({ line: 0, found: true }), '');
    }
  });
  reg('diffNotes.createComment', (r: vscode.CommentReply) => notes.create(r));
  reg('diffNotes.reply', (r: vscode.CommentReply) => notes.reply(r));
  reg('diffNotes.cancelDraft', (r: vscode.CommentReply | vscode.CommentThread) => notes.cancelDraft(r));
  reg('diffNotes.editComment', c => notes.startEdit(c));
  reg('diffNotes.saveComment', c => notes.saveEdit(c));
  reg('diffNotes.cancelEdit', c => notes.cancelEdit(c));
  const confirmDelete = async (message: string): Promise<boolean> => (await vscode.window.showWarningMessage(message, { modal: true }, 'Delete')) === 'Delete';
  const deleteNoteById = async (id: string): Promise<void> => {
    const c = store.get(id);
    if (!c) {
      return;
    }
    if (c.replies.length > 0 && !(await confirmDelete(`Delete this note and its ${c.replies.length} repl${c.replies.length === 1 ? 'y' : 'ies'}?`))) {
      return;
    }
    await deleteNotes([id]);
  };
  reg('diffNotes.deleteComment', async (comment: NoteComment) => {
    if (comment.noteId === comment.threadId) {
      await deleteNoteById(comment.threadId);
    } else {
      await notes.deleteReply(comment);
    }
  });
  reg('diffNotes.deleteNote', (node: { comment?: StoredComment }) => (node?.comment ? deleteNoteById(node.comment.id) : undefined));
  const bulkDelete = async (kind: string, pick: (unpushed: string[]) => StoredComment[]): Promise<void> => {
    const hit = pick((await git.unpushedCommits()).map(c => c.sha));
    if (hit.length === 0) {
      void vscode.window.showInformationMessage(`Diff Notes: no ${kind} notes to delete.`);
      return;
    }
    if (await confirmDelete(deletePrompt(hit.length, kind))) {
      await deleteNotes(hit.map(c => c.id));
    }
  };
  reg('diffNotes.deleteResolved', () => bulkDelete('resolved', () => resolvedNotes(store.all())));
  reg('diffNotes.deletePushed', () => bulkDelete('pushed', u => pushedNotes(store.all(), u)));
  reg('diffNotes.deleteOutdated', () => bulkDelete('outdated', () => outdatedNotes(store.all())));
  const copyMarkdown = async (src: { sections: import('./core/markdown').MdSection[]; commitLabel: (origin: string) => string }): Promise<void> => {
    const n = countNotes(src.sections);
    if (n === 0) {
      vscode.window.setStatusBarMessage('Diff Notes: nothing to copy', 3000);
      return;
    }
    await vscode.env.clipboard.writeText(notesToMarkdown(src.sections, src.commitLabel));
    vscode.window.setStatusBarMessage(`Diff Notes: Copied ${n} note${n === 1 ? '' : 's'}`, 3000);
  };
  reg('diffNotes.copyNotes', async () => copyMarkdown(await commentsView.sections()));
  reg('diffNotes.copyNode', async (node: ListNode) => (node ? copyMarkdown(await commentsView.sectionsFor(node)) : undefined));
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
