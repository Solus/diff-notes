/** Minimal typings for the parts of the built-in `vscode.git` extension API we use. */
import { Event, Uri } from 'vscode';

export interface GitExtension {
  readonly enabled: boolean;
  getAPI(version: 1): API;
}

export interface API {
  readonly state: 'uninitialized' | 'initialized';
  readonly onDidChangeState: Event<'uninitialized' | 'initialized'>;
  readonly git: { readonly path: string };
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  show(ref: string, path: string): Promise<string>;
  getConfig(key: string): Promise<string>;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly indexChanges: Change[];
  readonly workingTreeChanges: Change[];
  readonly untrackedChanges?: Change[];
  readonly onDidChange: Event<void>;
}

export interface Branch {
  readonly name?: string;
  readonly commit?: string;
  readonly upstream?: { readonly remote: string; readonly name: string };
}

export interface Change {
  readonly uri: Uri;
  readonly originalUri: Uri;
  readonly renameUri: Uri | undefined;
  readonly status: number;
}
