import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { hookScript, isOurs, planInstall, summaryText } from '../src/core/hook';
import { StoredComment, WORKING_TREE } from '../src/core/model';
import { HookManager } from '../src/hook';

const base: StoredComment = {
  id: '1', author: 'me', createdAt: '', body: 'first line\nsecond', replies: [], status: 'open',
  file: 'a.txt', side: 'new', startLine: 3, endLine: 3, snippet: { before: [], lines: [], after: [] }, origin: 'abc',
};

test('summary: only open, non-outdated commit comments', () => {
  const text = summaryText([
    base,
    { ...base, id: '2', status: 'resolved' },
    { ...base, id: '3', outdated: true },
    { ...base, id: '4', origin: WORKING_TREE },
  ]);
  assert.equal(text, 'abc\ta.txt\t3\tfirst line\n');
  assert.equal(summaryText([]), '');
});

test('plan: absent, ours, foreign', () => {
  assert.deepEqual(planInstall(undefined), { kind: 'write', chain: false });
  assert.deepEqual(planInstall(hookScript()), { kind: 'none' });
  assert.deepEqual(planInstall(hookScript() + '# old'), { kind: 'write', chain: false });
  assert.deepEqual(planInstall('#!/bin/sh\necho husky\n'), { kind: 'write', chain: true });
  assert.ok(isOurs(hookScript()));
});

// --- integration: real git + sh -------------------------------------------------------------
const hasSh = spawnSync('sh', ['-c', 'true']).status === 0;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@e.x', ...args], { cwd, encoding: 'utf8' });
}

function setup(): { repo: string; hooks: string; mgr: HookManager; tmp: string } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dn-hook-'));
  const remote = path.join(tmp, 'remote.git');
  const repo = path.join(tmp, 'repo');
  fs.mkdirSync(remote);
  fs.mkdirSync(repo);
  git(remote, 'init', '-q', '--bare', '-b', 'main');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(repo, 'a.txt'), '1\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  fs.writeFileSync(path.join(repo, 'a.txt'), '1\n2\n');
  git(repo, 'commit', '-q', '-am', 'two');
  const hooks = path.join(repo, '.git', 'hooks');
  return { repo, hooks, mgr: new HookManager(hooks, path.join(repo, '.git')), tmp };
}

/** Pushes with the hook's `/dev/tty` swapped for a file holding the typed answer. */
function push(repo: string, hooks: string, answer: string | undefined): { code: number; err: string } {
  const hookFile = path.join(hooks, 'pre-push');
  if (answer !== undefined) {
    const tty = path.join(repo, 'fake-tty').split(path.sep).join('/');
    fs.writeFileSync(tty, answer + '\n');
    fs.writeFileSync(hookFile, fs.readFileSync(hookFile, 'utf8').split('>/dev/tty').join('>/dev/null').split('/dev/tty').join(tty));
  }
  const r = spawnSync('git', ['push', 'origin', 'main'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? -1, err: r.stderr };
}

test('hook: asks when open comments exist, y pushes, N blocks, no tty pushes', { skip: !hasSh }, async () => {
  const { repo, hooks, mgr, tmp } = setup();
  try {
    const sha = git(repo, 'rev-parse', 'HEAD').trim();
    await mgr.writeSummary([{ ...base, origin: sha }]);
    assert.equal(await mgr.install(), 'installed');

    const no = push(repo, hooks, 'n');
    assert.equal(no.code, 1);
    assert.match(no.err, /open comments/);
    assert.match(no.err, /a\.txt:3/);

    const yes = push(repo, hooks, 'y');
    assert.equal(yes.code, 0, yes.err);
    // tty-less (answer undefined): re-install a pristine hook; nothing left to push, so add a commit
    fs.writeFileSync(path.join(repo, 'a.txt'), '3\n');
    git(repo, 'commit', '-q', '-am', 'three');
    await mgr.writeSummary([{ ...base, origin: git(repo, 'rev-parse', 'HEAD').trim() }]);
    await mgr.install();
    fs.writeFileSync(path.join(hooks, 'pre-push'), fs.readFileSync(path.join(hooks, 'pre-push'), 'utf8').split('/dev/tty').join('/nonexistent/tty'));
    const nt = push(repo, hooks, undefined);
    assert.equal(nt.code, 0, nt.err);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('hook: no open comments on pushed commits means silent push', { skip: !hasSh }, async () => {
  const { repo, hooks, mgr, tmp } = setup();
  try {
    await mgr.writeSummary([{ ...base, origin: 'f'.repeat(40) }]);
    await mgr.install();
    const r = push(repo, hooks, 'n');
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err, /open comments/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('hook: chains an existing hook, its failure blocks, uninstall restores it', { skip: !hasSh }, async () => {
  const { repo, hooks, mgr, tmp } = setup();
  try {
    fs.mkdirSync(hooks, { recursive: true });
    const orig = '#!/bin/sh\ncat >/dev/null\necho chained-ran >&2\nexit 1\n';
    fs.writeFileSync(path.join(hooks, 'pre-push'), orig, { mode: 0o755 });
    assert.equal(await mgr.install(), 'chained');
    assert.equal(await mgr.install(), 'unchanged');
    const r = push(repo, hooks, undefined);
    assert.equal(r.code, 1);
    assert.match(r.err, /chained-ran/);

    await mgr.uninstall();
    assert.equal(fs.readFileSync(path.join(hooks, 'pre-push'), 'utf8'), orig);
    assert.ok(!fs.existsSync(path.join(hooks, 'pre-push.diff-notes-chained')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('hook: uninstall removes ours and leaves a foreign hook alone', async () => {
  const { hooks, mgr, tmp } = setup();
  try {
    fs.mkdirSync(hooks, { recursive: true });
    await mgr.install();
    await mgr.uninstall();
    assert.ok(!fs.existsSync(path.join(hooks, 'pre-push')));
    fs.writeFileSync(path.join(hooks, 'pre-push'), '#!/bin/sh\n');
    await mgr.uninstall();
    assert.ok(fs.existsSync(path.join(hooks, 'pre-push')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
