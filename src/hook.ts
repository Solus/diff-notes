import { promises as fs } from 'fs';
import * as path from 'path';
import { CHAINED_NAME, hookScript, HOOK_NAME, isOurs, planInstall, summaryText } from './core/hook';
import { StoredComment } from './core/model';

/** Installs/removes the opt-in pre-push hook and keeps the summary file it reads up to date. */
export class HookManager {
  private readonly summaryFile: string;

  /** `hooksDir`: absolute hooks directory (honours core.hooksPath). `gitDir`: absolute git dir. */
  constructor(private readonly hooksDir: string, gitDir: string) {
    this.summaryFile = path.join(gitDir, 'diff-notes', 'open.txt');
  }

  async writeSummary(comments: readonly StoredComment[]): Promise<void> {
    await fs.mkdir(path.dirname(this.summaryFile), { recursive: true });
    const tmp = `${this.summaryFile}.tmp`;
    await fs.writeFile(tmp, summaryText(comments), 'utf8');
    await fs.rename(tmp, this.summaryFile);
  }

  private get hookFile(): string {
    return path.join(this.hooksDir, HOOK_NAME);
  }

  private get chainedFile(): string {
    return path.join(this.hooksDir, CHAINED_NAME);
  }

  private async readHook(): Promise<string | undefined> {
    try {
      return await fs.readFile(this.hookFile, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw e;
    }
  }

  /** Writes our hook; a foreign existing hook is moved aside and chained. Returns what happened. */
  async install(): Promise<'installed' | 'chained' | 'unchanged'> {
    const plan = planInstall(await this.readHook());
    if (plan.kind === 'none') {
      return 'unchanged';
    }
    await fs.mkdir(this.hooksDir, { recursive: true });
    if (plan.chain) {
      await fs.rm(this.chainedFile, { force: true });
      await fs.rename(this.hookFile, this.chainedFile);
    }
    await fs.writeFile(this.hookFile, hookScript(), { encoding: 'utf8', mode: 0o755 });
    await fs.chmod(this.hookFile, 0o755);
    return plan.chain ? 'chained' : 'installed';
  }

  /** Removes our hook and puts the chained one back. Leaves a foreign hook alone. */
  async uninstall(): Promise<void> {
    const text = await this.readHook();
    if (text !== undefined && !isOurs(text)) {
      return;
    }
    if (text !== undefined) {
      await fs.rm(this.hookFile, { force: true });
    }
    try {
      await fs.rename(this.chainedFile, this.hookFile);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
    }
  }
}
