import * as vscode from 'vscode';
import { decodeQuery, DiffSide, encodeQuery, SCHEME } from './core/diffRef';

export interface DiffDoc extends DiffSide {
  /** Repo-relative path, forward slashes. */
  file: string;
}

/** URI of one read-only side of a diff. Deterministic, so stored comments map back to it. */
export function diffUri(d: DiffDoc): vscode.Uri {
  return vscode.Uri.from({ scheme: SCHEME, path: '/' + d.file, query: encodeQuery(d) });
}

export function parseDiffUri(uri: vscode.Uri): DiffDoc | undefined {
  if (uri.scheme !== SCHEME) {
    return undefined;
  }
  const q = decodeQuery(uri.query);
  return q && { ...q, file: uri.path.replace(/^\//, '') };
}
