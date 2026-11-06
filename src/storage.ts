import { promises as fs } from 'fs';
import * as path from 'path';
import { parseGitdirPointer } from './core/diffRef';

/** Absolute path of the repo's git dir (follows a `.git` file pointer for linked worktrees). */
export async function resolveGitDir(root: string): Promise<string> {
  const dotGit = path.join(root, '.git');
  const stat = await fs.stat(dotGit);
  if (stat.isDirectory()) {
    return dotGit;
  }
  const target = parseGitdirPointer(await fs.readFile(dotGit, 'utf8'));
  if (!target) {
    throw new Error(`Cannot read git dir pointer in ${dotGit}`);
  }
  return path.resolve(root, target);
}

/** Reads/writes `<gitdir>/diff-notes/comments.json`. Writes are serialized and atomic. */
export class NotesFileIO {
  readonly file: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(gitDir: string) {
    this.file = path.join(gitDir, 'diff-notes', 'comments.json');
  }

  async read(): Promise<string | undefined> {
    try {
      return await fs.readFile(this.file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw e;
    }
  }

  write(text: string): Promise<void> {
    const job = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, text, 'utf8');
      await fs.rename(tmp, this.file);
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}
