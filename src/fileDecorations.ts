import * as vscode from 'vscode';
import { countOpenInFile } from './core/commentList';
import { CommentStore } from './core/store';
import { FileStatus } from './core/gitParse';
import { parseDiffUri } from './diffUri';

/** Git status per Commits file-row URI, filled by the Commits view. */
export const fileStatuses = new Map<string, FileStatus>();

const GIT_COLOUR: Record<FileStatus, string> = {
  A: 'gitDecoration.addedResourceForeground',
  M: 'gitDecoration.modifiedResourceForeground',
  D: 'gitDecoration.deletedResourceForeground',
  R: 'gitDecoration.renamedResourceForeground',
  C: 'gitDecoration.renamedResourceForeground',
  T: 'gitDecoration.modifiedResourceForeground',
};

/** Git status letter on Commits file rows (their `diff-notes:` URIs); name turns amber when the file has open notes. */
export class FileDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private readonly reg = vscode.window.registerFileDecorationProvider(this);

  constructor(private readonly store: CommentStore) {}

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const d = parseDiffUri(uri);
    if (!d) {
      return undefined;
    }
    const status = fileStatuses.get(uri.toString());
    const n = countOpenInFile(this.store.all(), d.origin, d.file);
    if (!status && n === 0) {
      return undefined;
    }
    const colour = n > 0 ? 'diffNotes.fileNoteForeground' : status ? GIT_COLOUR[status] : undefined;
    return new vscode.FileDecoration(status, status, colour ? new vscode.ThemeColor(colour) : undefined);
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  dispose(): void {
    this.reg.dispose();
    this.changed.dispose();
  }
}
