import * as path from 'path';
import * as vscode from 'vscode';
import { markerSpans } from './core/markers';
import { CommentStore } from './core/store';
import { parseDiffUri } from './diffUri';

/** Amber gutter stripe and scrollbar mark on lines with open notes, in both sides of our diffs. */
export class Markers implements vscode.Disposable {
  private readonly type: vscode.TextEditorDecorationType;
  private readonly subs: vscode.Disposable[];

  constructor(private readonly store: CommentStore, _ctx?: vscode.ExtensionContext) {
    const icon = (t: string) => vscode.Uri.file(path.join(__dirname, '..', 'media', `note-stripe-${t}.svg`));
    this.type = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      gutterIconPath: icon('dark'),
      gutterIconSize: '100% 100%',
      light: { gutterIconPath: icon('light') },
      dark: { gutterIconPath: icon('dark') },
      overviewRulerColor: new vscode.ThemeColor('diffNotes.overviewRulerMarker'),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
    });
    this.subs = [
      vscode.window.onDidChangeVisibleTextEditors(() => this.refresh()),
      vscode.workspace.onDidOpenTextDocument(() => this.refresh()),
    ];
    this.refresh();
  }

  /** Re-apply to every visible diff editor (call after notes change or move). */
  refresh(): void {
    for (const ed of vscode.window.visibleTextEditors) {
      const d = parseDiffUri(ed.document.uri);
      const spans = d ? markerSpans(this.store.all(), d.file, d) : [];
      ed.setDecorations(this.type, spans.map(([a, b]) => new vscode.Range(a, 0, b, 0)));
    }
  }

  dispose(): void {
    this.subs.forEach(s => s.dispose());
    this.type.dispose();
  }
}
