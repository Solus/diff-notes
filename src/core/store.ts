import { randomUUID } from 'crypto';
import { NotesFile, Reply, SCHEMA_VERSION, Status, StoredComment } from './model';

export type NewComment = Omit<StoredComment, 'id' | 'createdAt' | 'replies' | 'status'>;

/** In-memory comment collection with JSON (de)serialization. No I/O, no vscode. */
export class CommentStore {
  private comments: StoredComment[] = [];

  constructor(
    private readonly newId: () => string = randomUUID,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Parse file contents. Throws on malformed JSON or unknown schema version. */
  static parse(text: string): StoredComment[] {
    const data = JSON.parse(text) as Partial<NotesFile>;
    if (data.version !== SCHEMA_VERSION) {
      throw new Error(`Unsupported diff-notes schema version: ${String(data.version)}`);
    }
    if (!Array.isArray(data.comments)) {
      throw new Error('diff-notes file has no comments array');
    }
    return data.comments.map(c => ({ ...c, replies: c.replies ?? [] }));
  }

  load(text: string | undefined): void {
    this.comments = text === undefined || text.trim() === '' ? [] : CommentStore.parse(text);
  }

  serialize(): string {
    const file: NotesFile = { version: SCHEMA_VERSION, comments: this.comments };
    return JSON.stringify(file, null, 2) + '\n';
  }

  all(): readonly StoredComment[] {
    return this.comments;
  }

  get(id: string): StoredComment | undefined {
    return this.comments.find(c => c.id === id);
  }

  add(input: NewComment): StoredComment {
    const c: StoredComment = { ...input, id: this.newId(), createdAt: this.now(), replies: [], status: 'open' };
    this.comments.push(c);
    return c;
  }

  reply(commentId: string, author: string, body: string): Reply {
    const c = this.require(commentId);
    const r: Reply = { id: this.newId(), author, createdAt: this.now(), body };
    c.replies.push(r);
    return r;
  }

  /** Edit the body of a comment or of a reply, found by id. Returns the owning comment. */
  edit(id: string, body: string): StoredComment {
    for (const c of this.comments) {
      if (c.id === id) {
        c.body = body;
        c.editedAt = this.now();
        return c;
      }
      const r = c.replies.find(x => x.id === id);
      if (r) {
        r.body = body;
        r.editedAt = this.now();
        return c;
      }
    }
    throw new Error(`No comment or reply with id ${id}`);
  }

  setStatus(commentId: string, status: Status): StoredComment {
    const c = this.require(commentId);
    c.status = status;
    return c;
  }

  private require(id: string): StoredComment {
    const c = this.get(id);
    if (!c) {
      throw new Error(`No comment with id ${id}`);
    }
    return c;
  }
}
