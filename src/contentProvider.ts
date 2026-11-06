import * as vscode from 'vscode';
import { SCHEME } from './core/diffRef';
import { WORKING_TREE } from './core/model';
import { parseDiffUri } from './diffUri';
import { GitService } from './git';

/** Serves the read-only `diff-notes:` documents shown on both sides of our diffs. */
export class DiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly git: GitService) {}

  provideTextDocumentContent(uri: vscode.Uri): Promise<string> | string {
    const d = parseDiffUri(uri);
    return d ? this.git.readSide(d.file, d) : '';
  }

  /** Working-tree docs follow HEAD and the disk; refresh any that are open. */
  refreshWorkingTree(): void {
    for (const doc of vscode.workspace.textDocuments) {
      if (doc.uri.scheme === SCHEME && parseDiffUri(doc.uri)?.origin === WORKING_TREE) {
        this.changed.fire(doc.uri);
      }
    }
  }

  dispose(): void {
    this.changed.dispose();
  }
}
