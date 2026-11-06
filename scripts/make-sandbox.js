// Creates a throwaway git repo in ./sandbox for F5 testing. Idempotent: does nothing if it exists.
// `--reset` deletes sandbox/ and the bare remote first.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sandbox = path.join(root, 'sandbox');
const remote = path.join(root, 'sandbox-remote.git');

if (process.argv.includes('--reset')) {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(remote, { recursive: true, force: true });
}
if (fs.existsSync(sandbox)) {
  console.log('sandbox already exists (use `npm run sandbox:reset` to recreate)');
  process.exit(0);
}
fs.rmSync(remote, { recursive: true, force: true });

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=Sandbox', '-c', 'user.email=sandbox@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe' });
const write = (name, text) => fs.writeFileSync(path.join(sandbox, name), text);
const commit = (msg) => { git(sandbox, 'add', '-A'); git(sandbox, 'commit', '-q', '-m', msg); };

fs.mkdirSync(remote, { recursive: true });
git(remote, 'init', '-q', '--bare', '-b', 'main');
fs.mkdirSync(sandbox, { recursive: true });
git(sandbox, 'init', '-q', '-b', 'main');
git(sandbox, 'remote', 'add', 'origin', remote);

write('README.md', '# Sandbox\n\nA throwaway repo for trying Diff Notes.\n');
write('greet.js', [
  'function greet(name) {',
  '  return "Hello, " + name;',
  '}',
  '',
  'module.exports = { greet };',
  '',
].join('\n'));
write('notes.txt', ['line one', 'line two', 'line three', 'line four', 'line five', ''].join('\n'));
commit('Initial commit');
git(sandbox, 'push', '-q', '-u', 'origin', 'main');

write('greet.js', [
  'function greet(name, punctuation) {',
  '  const suffix = punctuation || "!";',
  '  const message = "Hello, " + name + suffix;',
  '  return message;',
  '}',
  '',
  'module.exports = { greet };',
  '',
].join('\n'));
write('math.js', [
  'function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'function sub(a, b) {',
  '  return a - b;',
  '}',
  '',
  'module.exports = { add, sub };',
  '',
].join('\n'));
commit('Add punctuation to greet, add math helpers');

write('notes.txt', ['line one', 'line 2 (edited)', 'line three', 'a new line', 'line four', 'line five', 'line six', ''].join('\n'));
write('math.js', [
  'function add(a, b) {',
  '  return a + b;',
  '}',
  '',
  'function sub(a, b) {',
  '  return a - b;',
  '}',
  '',
  'function mul(a, b) {',
  '  return a * b;',
  '}',
  '',
  'module.exports = { add, sub, mul };',
  '',
].join('\n'));
commit('Edit notes, add mul');

// Uncommitted work: modify two tracked files, add one untracked file.
write('README.md', '# Sandbox\n\nA throwaway repo for trying Diff Notes.\n\n## Usage\n\nOpen the Diff Notes view and add notes.\n');
write('greet.js', fs.readFileSync(path.join(sandbox, 'greet.js'), 'utf8').replace('"!"', '"?"'));
write('scratch.txt', 'untracked file\nsecond line\n');

console.log('sandbox created at ' + sandbox);
