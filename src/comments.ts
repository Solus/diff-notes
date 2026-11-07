import * as vscode from 'vscode';
import { END_OF_LINE, linesFromRange } from './core/threadRange';
import { OUTDATED_SCHEME } from './core/diffRef';
import { rangeLabel, StoredComment } from './core/model';
import { extractSnippet, splitLines } from './core/snippet';
import { CommentStore } from './core/store';
import { diffUri, parseDiffUri } from './diffUri';
import { GitService } from './git';

/** One rendered comment (the root note or a reply) inside a thread. */
export class NoteComment implements vscode.Comment {
  mode = vscode.CommentMode.Preview;
  readonly contextValue = 'editable';
  readonly author: vscode.CommentAuthorInformation;
  readonly timestamp: Date;
  readonly label: string | undefined;

  constructor(
    /** Id of the stored comment or reply. */
    readonly noteId: string,
    /** Id of the stored comment that owns the thread. */
    readonly threadId: string,
    public body: string | vscode.MarkdownString,
    author: string,
    createdAt: string,
    editedAt: string | undefined,
  ) {
    this.author = { name: author };
    this.timestamp = new Date(createdAt);
    this.label = editedAt ? 'edited' : undefined;
  }
}

function bodyText(body: string | vscode.MarkdownString): string {
  return typeof body === 'string' ? body : body.value;
}

/** Bridges stored comments and native Comment API threads on `diff-notes:` diff documents. */
/** URI of the read-only outdated view of a comment (its stored snippet). */
export function outdatedUri(c: StoredComment): vscode.Uri {
  return vscode.Uri.from({ scheme: OUTDATED_SCHEME, path: '/' + c.file, query: new URLSearchParams({ id: c.id }).toString() });
}

/** Serves the stored snippet (context + commented lines) of an outdated comment. */
export class OutdatedContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly store: CommentStore) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const c = this.store.get(new URLSearchParams(uri.query).get('id') ?? '');
    return c ? [...c.snippet.before, ...c.snippet.lines, ...c.snippet.after].join(String.fromCharCode(10)) : '';
  }
}

export class NotesController implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController('diffNotes', 'Diff Notes');
  private readonly threads = new Map<string, vscode.CommentThread>();
  private readonly threadIds = new WeakMap<vscode.CommentThread, string>();
  /** Ids whose thread sits on the outdated view rather than a live diff. */
  private readonly outdatedIds = new Set<string>();
  /** Empty new threads we have seen (VS Code hands us a new thread only through Cancel / Save). */
  private readonly drafts = new Set<vscode.CommentThread>();
  private readonly tabWatch = vscode.window.tabGroups.onDidChangeTabs(() => this.pruneDrafts());

  constructor(
    private readonly store: CommentStore,
    private readonly git: GitService,
    private readonly persist: () => Promise<void>,
  ) {
    this.controller.options = { prompt: 'Add a note', placeHolder: 'Note to self (Ctrl+Enter to save)' };
    // Comments only in our diff documents, never in normal editors.
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: doc => (parseDiffUri(doc.uri) ? [new vscode.Range(0, 0, Math.max(0, doc.lineCount - 1), 0)] : []),
    };
  }

  /** Recreate threads for every stored comment (on start). */
  restoreAll(): void {
    for (const c of this.store.all()) {
      this.sync(c);
    }
  }

  /**
   * Make the live thread match the stored comment after its anchor changed:
   * move it, move it to another diff (new origin), or drop it when outdated
   * (outdated comments get a thread only while their outdated view is open).
   */
  sync(c: StoredComment): void {
    const old = this.threads.get(c.id);
    if (c.outdated) {
      if (old && !this.outdatedIds.has(c.id)) {
        this.drop(c.id);
      } else if (old) {
        this.render(old, c);
      }
      return;
    }
    if (old && this.outdatedIds.has(c.id)) {
      this.drop(c.id);
    }
    const uri = diffUri({ file: c.file, origin: c.origin, side: c.side });
    const range = new vscode.Range(c.startLine - 1, 0, c.endLine - 1, END_OF_LINE);
    const live = this.threads.get(c.id);
    if (live && live.uri.toString() === uri.toString()) {
      live.range = range;
      this.render(live, c);
      return;
    }
    if (live) {
      this.drop(c.id);
    }
    const thread = this.controller.createCommentThread(uri, range, []);
    this.bind(thread, c.id);
    this.render(thread, c);
  }

  /** Thread on the read-only outdated view of `c` (created on first open). Returns the document URI and range to show. */
  openOutdatedThread(c: StoredComment): { uri: vscode.Uri; range: vscode.Range } {
    const uri = outdatedUri(c);
    const first = c.snippet.before.length;
    const range = new vscode.Range(first, 0, first + Math.max(0, c.snippet.lines.length - 1), END_OF_LINE);
    if (!this.threads.has(c.id)) {
      const thread = this.controller.createCommentThread(uri, range, []);
      this.outdatedIds.add(c.id);
      this.bind(thread, c.id);
      this.render(thread, c);
    }
    return { uri, range };
  }

  /** Open the thread box of comment `id` (if it has a live thread). */
  expand(id: string): void {
    const t = this.threads.get(id);
    if (t) {
      t.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
  }

  /** Id of the stored comment behind a thread. */
  idOf(thread: vscode.CommentThread): string | undefined {
    return this.threadIds.get(thread);
  }

  /** Remove the live thread of a deleted note. */
  remove(id: string): void {
    this.drop(id);
  }

  /** Delete one reply and redraw its thread. */
  async deleteReply(comment: NoteComment): Promise<void> {
    const c = this.store.removeReply(comment.noteId);
    if (c) {
      this.sync(c);
      await this.persist();
    }
  }

  private drop(id: string): void {
    this.threads.get(id)?.dispose();
    this.threads.delete(id);
    this.outdatedIds.delete(id);
  }

  async create(reply: vscode.CommentReply): Promise<void> {
    const { thread, text } = reply;
    const d = parseDiffUri(thread.uri);
    if (!d || !text.trim()) {
      this.drafts.add(thread);
      return;
    }
    this.drafts.delete(thread);
    const range = thread.range ?? new vscode.Range(0, 0, 0, 0);
    const { startLine, endLine } = linesFromRange(range.start, range.end);
    const doc = await vscode.workspace.openTextDocument(thread.uri);
    const c = this.store.add({
      author: await this.git.author(),
      body: text,
      file: d.file,
      side: d.side,
      origin: d.origin,
      startLine,
      endLine,
      snippet: extractSnippet(splitLines(doc.getText()), startLine, endLine),
    });
    this.bind(thread, c.id);
    this.render(thread, c);
    await this.persist();
  }

  async reply(reply: vscode.CommentReply): Promise<void> {
    const id = this.threadIds.get(reply.thread);
    if (!id || !reply.text.trim()) {
      return;
    }
    this.store.reply(id, await this.git.author(), reply.text);
    this.render(reply.thread, this.store.get(id)!);
    await this.persist();
  }

  /** Cancel in the reply box: always closes, no confirmation. VS Code passes a CommentReply ({ thread, text }). */
  cancelDraft(arg: vscode.CommentReply | vscode.CommentThread): void {
    this.closeThread('thread' in arg ? arg.thread : arg);
  }


  private closeThread(thread: vscode.CommentThread): void {
    if (this.threadIds.has(thread)) {
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    } else {
      this.drafts.delete(thread);
      thread.dispose();
    }
  }

  /** Dispose empty new threads (seen via Cancel/empty save) whose diff is no longer open in any tab. */
  private pruneDrafts(): void {
    const open = new Set<string>();
    for (const g of vscode.window.tabGroups.all) {
      for (const t of g.tabs) {
        const i = t.input;
        if (i instanceof vscode.TabInputTextDiff) {
          open.add(i.original.toString());
          open.add(i.modified.toString());
        } else if (i instanceof vscode.TabInputText) {
          open.add(i.uri.toString());
        }
      }
    }
    for (const t of [...this.drafts]) {
      if (this.threadIds.has(t)) {
        this.drafts.delete(t);
      } else if (!open.has(t.uri.toString())) {
        this.drafts.delete(t);
        t.dispose();
      }
    }
  }

  startEdit(comment: NoteComment): void {
    this.setMode(comment, vscode.CommentMode.Editing);
  }

  async saveEdit(comment: NoteComment): Promise<void> {
    const text = bodyText(comment.body);
    const thread = this.threads.get(comment.threadId);
    if (!thread) {
      return;
    }
    if (!text.trim()) {
      this.render(thread, this.store.get(comment.threadId)!);
      return;
    }
    const c = this.store.edit(comment.noteId, text);
    this.render(thread, c);
    await this.persist();
  }

  cancelEdit(comment: NoteComment): void {
    const thread = this.threads.get(comment.threadId);
    const c = this.store.get(comment.threadId);
    if (thread && c) {
      this.render(thread, c);
    }
  }

  async setStatus(thread: vscode.CommentThread, status: StoredComment['status']): Promise<void> {
    const id = this.threadIds.get(thread);
    if (!id) {
      return;
    }
    const c = this.store.setStatus(id, status);
    this.render(thread, c);
    await this.persist();
  }

  dispose(): void {
    this.tabWatch.dispose();
    this.controller.dispose();
  }

  private bind(thread: vscode.CommentThread, id: string): void {
    this.threads.set(id, thread);
    this.threadIds.set(thread, id);
  }

  private render(thread: vscode.CommentThread, c: StoredComment): void {
    thread.comments = [
      new NoteComment(c.id, c.id, c.body, c.author, c.createdAt, c.editedAt),
      ...c.replies.map(r => new NoteComment(r.id, c.id, r.body, r.author, r.createdAt, r.editedAt)),
    ];
    thread.label = c.outdated ? `Outdated · ${rangeLabel(c)}` : rangeLabel(c);
    thread.contextValue = c.outdated ? `outdated-${c.status}` : c.status;
    thread.state = c.status === 'resolved' ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
    thread.canReply = true;
    // Resolved notes are hidden (collapsed), never deleted.
    thread.collapsibleState =
      c.status === 'resolved' ? vscode.CommentThreadCollapsibleState.Collapsed : vscode.CommentThreadCollapsibleState.Expanded;
  }

  private setMode(comment: NoteComment, mode: vscode.CommentMode): void {
    const thread = this.threads.get(comment.threadId);
    if (!thread) {
      return;
    }
    thread.comments = thread.comments.map(x => {
      if (x instanceof NoteComment && x.noteId === comment.noteId) {
        x.mode = mode;
      }
      return x;
    });
  }
}
