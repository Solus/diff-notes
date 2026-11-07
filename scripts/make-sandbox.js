// Creates a throwaway git repo in ./sandbox for F5 testing. Idempotent: does nothing if it exists.
// `--reset` deletes sandbox/ and the bare remote first.
//
// The repo holds a small multi-language project (scripts/sandbox-seed/), a history with two pushed and
// four unpushed commits, uncommitted work, and a seeded .git/diff-notes/comments.json. Everything is
// deterministic: fixed author/committer dates, fixed note ids and timestamps.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const sandbox = path.join(root, 'sandbox');
const remote = path.join(root, 'sandbox-remote.git');
const seed = path.join(__dirname, 'sandbox-seed');

if (process.argv.includes('--reset')) {
  fs.rmSync(sandbox, { recursive: true, force: true });
  fs.rmSync(remote, { recursive: true, force: true });
}
if (fs.existsSync(sandbox)) {
  console.log('sandbox already exists (use `npm run sandbox:reset` to recreate)');
  process.exit(0);
}
fs.rmSync(remote, { recursive: true, force: true });

const ALEX = { name: 'Alex Rivera', email: 'alex@example.com' };
const MIA = { name: 'Mia Chen', email: 'mia@example.com' };

const git = (cwd, args, env = {}) =>
  execFileSync('git', ['-c', 'core.autocrlf=false', ...args], { cwd, stdio: 'pipe', env: { ...process.env, ...env } }).toString();
const sg = (...args) => git(sandbox, args);
const file = (name) => path.join(sandbox, name);
const read = (name) => fs.readFileSync(file(name), 'utf8');
const write = (name, text) => {
  fs.mkdirSync(path.dirname(file(name)), { recursive: true });
  fs.writeFileSync(file(name), text);
};
/** Replace `from` with `to` in a file; fails loudly if `from` is not found exactly once. */
const edit = (name, from, to) => {
  const text = read(name);
  if (text.split(from).length !== 2) {
    throw new Error('sandbox edit: expected exactly one match in ' + name + ': ' + from);
  }
  write(name, text.replace(from, () => to));
};
const copyTree = (dir, rel = '') => {
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) {
      copyTree(dir, r);
    } else {
      write(r, fs.readFileSync(path.join(dir, r), 'utf8'));
    }
  }
};

const shas = {};
const commit = (key, who, date, msg) => {
  const env = {
    GIT_AUTHOR_NAME: who.name,
    GIT_AUTHOR_EMAIL: who.email,
    GIT_COMMITTER_NAME: who.name,
    GIT_COMMITTER_EMAIL: who.email,
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  };
  git(sandbox, ['add', '-A'], env);
  git(sandbox, ['commit', '-q', '-m', msg], env);
  shas[key] = sg('rev-parse', 'HEAD').trim();
};

fs.mkdirSync(remote, { recursive: true });
git(remote, ['init', '-q', '--bare', '-b', 'main']);
fs.mkdirSync(sandbox, { recursive: true });
sg('init', '-q', '-b', 'main');
sg('config', 'user.name', ALEX.name);
sg('config', 'user.email', ALEX.email);
sg('remote', 'add', 'origin', remote);

// --- Pushed commit 1: initial project ---------------------------------------------------------------
copyTree(seed);
commit('c1', ALEX, '2026-10-01T09:00:00+00:00', 'Initial project: inventory, orders, report script');

// --- Pushed commit 2: feature (coupons) -------------------------------------------------------------
edit('src/orders.ts', '  createdAt: Date;\n  totalCents: number;\n}', '  createdAt: Date;\n  totalCents: number;\n  discountCents: number;\n  couponCode?: string;\n}');
edit('src/orders.ts', 'export class OrderService {', "const COUPONS: Record<string, number> = {\n  WELCOME10: 0.1,\n  SPRING20: 0.2,\n};\n\nexport class OrderService {");
edit('src/orders.ts', 'items: Array<{ sku: string; quantity: number }>): Promise<Order> {', 'items: Array<{ sku: string; quantity: number }>, couponCode?: string): Promise<Order> {');
edit('src/orders.ts', '    const order: Order = {', '    const discountCents = applyCoupon(calculateTotal(lines), couponCode);\n    const order: Order = {');
edit('src/orders.ts', '      totalCents: calculateTotal(lines),\n    };', '      totalCents: calculateTotal(lines) - discountCents,\n      discountCents,\n      couponCode,\n    };');
edit(
  'src/orders.ts',
  'function validateOrder(',
  [
    'export function applyCoupon(subtotalCents: number, couponCode?: string): number {',
    '  if (!couponCode) {',
    '    return 0;',
    '  }',
    '  const rate = COUPONS[couponCode.toUpperCase()];',
    '  if (rate === undefined) {',
    "    throw new OrderValidationError(['unknown coupon: ' + couponCode]);",
    '  }',
    '  return Math.round(subtotalCents * rate);',
    '}',
    '',
    'function validateOrder(',
  ].join('\n'),
);
edit(
  'test/orders.test.ts',
  "  it('cannot ship an unpaid order'",
  [
    "  it('applies a coupon', async () => {",
    "    const order = await ctx.orders.placeOrder('c1', [{ sku: 'MUG', quantity: 2 }], 'WELCOME10');",
    '    assert.equal(order.discountCents, 240);',
    '    assert.equal(order.totalCents, 2160);',
    '  });',
    '',
    "  it('cannot ship an unpaid order'",
  ].join('\n'),
);
edit('config/app.json', '"coupons": false', '"coupons": true');
edit(
  'README.md',
  '## Reports\n',
  [
    '## Coupons',
    '',
    'Pass a coupon code as the third argument to `placeOrder`. Codes are',
    'case-insensitive; an unknown code rejects the order. Available codes:',
    '',
    '- `WELCOME10`: 10% off',
    '- `SPRING20`: 20% off',
    '',
    '## Reports',
    '',
  ].join('\n'),
);
commit('c2', MIA, '2026-10-05T14:30:00+00:00', 'Add coupon support to orders');
sg('push', '-q', '-u', 'origin', 'main');

// --- Unpushed 1: refactor (move validateOrder above the class, tighten checks) ----------------------
{
  const text = read('src/orders.ts');
  const at = text.indexOf('function validateOrder(');
  const rest = text.slice(0, at).trimEnd() + '\n';
  const moved = [
    'function validateOrder(customerId: string, lines: OrderLine[]): void {',
    '  const problems: string[] = [];',
    '  if (!customerId) {',
    "    problems.push('customer id is required');",
    '  }',
    '  if (lines.length === 0) {',
    "    problems.push('order has no lines');",
    '  }',
    '  const seen = new Set<string>();',
    '  for (const line of lines) {',
    '    if (seen.has(line.sku)) {',
    "      problems.push('duplicate line for ' + line.sku);",
    '    }',
    '    seen.add(line.sku);',
    '    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {',
    "      problems.push('invalid quantity for ' + line.sku);",
    '    }',
    '    if (!Number.isFinite(line.unitPriceCents) || line.unitPriceCents < 0) {',
    "      problems.push('negative price for ' + line.sku);",
    '    }',
    '  }',
    '  if (problems.length > 0) {',
    '    throw new OrderValidationError(problems);',
    '  }',
    '}',
    '',
    '',
  ].join('\n');
  write('src/orders.ts', rest.replace('const COUPONS:', () => moved + 'const COUPONS:'));
}
commit('u1', ALEX, '2026-10-12T10:15:00+00:00', 'Move validateOrder above OrderService and reject duplicate lines');

// --- Unpushed 2: rename utils.ts -> helpers.ts and edit it ------------------------------------------
sg('mv', 'src/utils.ts', 'src/helpers.ts');
edit('src/helpers.ts', "    .normalize('NFKD')\n", "    .normalize('NFKD')\n    .replace(/[\\u0300-\\u036f]/g, '')\n");
edit(
  'src/helpers.ts',
  'export function chunk<T>',
  "export function formatPercent(ratio: number, digits = 1): string {\n  return roundTo(ratio * 100, digits).toFixed(digits) + '%';\n}\n\nexport function chunk<T>",
);
edit('src/helpers.ts', '  baseDelayMs: number;\n', '  baseDelayMs: number;\n  maxDelayMs?: number;\n');
edit(
  'src/helpers.ts',
  '      const delay = options.baseDelayMs * Math.pow(2, attempt);',
  '      const delay = Math.min(options.baseDelayMs * Math.pow(2, attempt), options.maxDelayMs ?? 5000);',
);
edit('src/inventory.ts', "from './utils'", "from './helpers'");
edit('src/orders.ts', "from './utils'", "from './helpers'");
edit('test/orders.test.ts', "from '../src/utils'", "from '../src/helpers'");
commit('u2', MIA, '2026-10-19T16:45:00+00:00', 'Rename utils to helpers; cap retry delay and fix slugify accents');

// --- Unpushed 3: delete legacy.ts -------------------------------------------------------------------
sg('rm', '-q', 'src/legacy.ts');
commit('u3', ALEX, '2026-10-26T11:00:00+00:00', 'Remove unused legacy price helpers');

// --- Unpushed 4: small bugfix touching several files ------------------------------------------------
edit('src/inventory.ts', 'if (quantity > available - 1) {', 'if (quantity > available) {');
edit('scripts/report.py', '    paid = [r for r in report.rows if r.status in ("paid", "shipped")]\n', '    paid = [r for r in report.rows if r.status in ("paid", "shipped")]\n    if not paid:\n        return 0.0\n');
edit('config/app.json', '"reservationTtlMinutes": 30', '"reservationTtlMinutes": 15');
edit('README.md', '| `inventory.reservationTtlMinutes` | How long unpaid orders hold stock | 30 |', '| `inventory.reservationTtlMinutes` | How long unpaid orders hold stock | 15 |');
commit('u4', MIA, '2026-11-02T09:20:00+00:00', 'Fix off-by-one in reserve, empty-report crash and reservation TTL');

// --- Working tree: two unstaged edits, one staged edit, one untracked file --------------------------
edit(
  'src/orders.ts',
  "export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';\n",
  [
    "export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';",
    '',
    "export type Currency = 'EUR' | 'USD' | 'GBP';",
    '',
    '/** Orders above this value need manual review before shipping. */',
    'export const REVIEW_THRESHOLD_CENTS = 50000;',
    '',
  ].join('\n'),
);
edit('src/orders.ts', "throw new Error('Only paid orders can be shipped');", "throw new Error('Order ' + orderId + ' is ' + order.status + '; only paid orders can be shipped');");
edit(
  'scripts/report.py',
  'def percent(part: float, whole: float) -> str:\n    return',
  'def percent(part: float, whole: float) -> str:\n    if whole == 0:\n        return "n/a"\n    return',
);
edit('config/app.json', '"reservationTtlMinutes": 15', '"reservationTtlMinutes": 10');
edit('config/app.json', '"waitlist": false', '"waitlist": true');
sg('add', 'config/app.json');
write(
  'scripts/sample-orders.csv',
  [
    'order_id,customer_id,sku,quantity,unit_price,status,created_at',
    'ord_1,c1,MUG,2,12.00,paid,2026-10-30T10:00:00',
    'ord_2,c2,CAP,1,18.00,shipped,2026-10-31T12:30:00',
    'ord_3,c1,MUG,1,12.00,cancelled,2026-11-01T08:15:00',
    'ord_4,c3,CAP,x,18.00,paid,2026-11-01T09:00:00',
    '',
  ].join('\n'),
);

// --- Seeded notes ------------------------------------------------------------------------------------
// Snippets are derived exactly like the extension does (src/core/snippet.ts: 3 lines of context).
const SNIPPET_CONTEXT = 3;
const splitLines = (text) => text.split(/\r?\n/);
const extractSnippet = (lines, startLine, endLine, context = SNIPPET_CONTEXT) => {
  const s = Math.max(1, Math.min(startLine, endLine));
  const e = Math.min(lines.length, Math.max(startLine, endLine));
  return {
    before: lines.slice(Math.max(0, s - 1 - context), s - 1),
    lines: lines.slice(s - 1, e),
    after: lines.slice(e, e + context),
  };
};
const uuid = (key) => {
  const h = crypto.createHash('sha1').update('diff-notes-sandbox:' + key).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
};

/** Text of `name` on the commented side of a note's origin. */
const sideText = (origin, name, side) => {
  if (origin === 'working-tree') {
    return side === 'new' ? read(name) : sg('show', 'HEAD:' + name);
  }
  return sg('show', (side === 'new' ? origin : origin + '^') + ':' + name);
};

const specs = [];
const note = (spec) => specs.push(spec);

const LONG_BODY =
  'Calling this out because it bit us last quarter: when the paid-order list is empty, this used to divide by zero ' +
  'and the whole nightly report job crashed without writing any output, which nobody noticed until finance asked ' +
  'where the numbers were. Returning 0.0 hides the problem rather than fixing it, so I would like us to decide ' +
  'whether an empty report should be an error (exit code 1 with a clear message) or a valid report with zeros. ' +
  'If it is the latter, the markdown formatter needs the same guard, and so does `percent()`, and we should add ' +
  'a test with an all-cancelled CSV so this does not regress. Happy to take the follow-up, but I want a decision first.';

// Working tree
note({ key: 'wt-1', origin: 'working-tree', file: 'src/orders.ts', side: 'new', from: 'export const REVIEW_THRESHOLD_CENTS', author: ALEX, at: '2026-11-05T09:10:00Z',
  body: 'Should this come from `config/app.json` instead of being hardcoded?' });
note({ key: 'wt-2', origin: 'working-tree', file: 'scripts/report.py', side: 'new', from: 'def percent', to: 'return "%.1f%%"', author: MIA, at: '2026-11-05T10:00:00Z',
  body: 'Is "n/a" the right output here? The text report pads this column, so it may look odd.',
  replies: [{ author: ALEX, at: '2026-11-05T10:20:00Z', body: 'Maybe `0.0%` is friendlier. Though that hides the empty case.' }] });
note({ key: 'wt-3', origin: 'working-tree', file: 'src/orders.ts', side: 'old', from: "Only paid orders can be shipped", author: MIA, at: '2026-11-05T11:30:00Z',
  body: 'The old message was fine for the UI. Does anything match on this text?' });
note({ key: 'wt-4', origin: 'working-tree', file: 'config/app.json', side: 'new', from: '"waitlist": true', author: ALEX, at: '2026-11-06T08:00:00Z',
  body: 'Flag is on but the waitlist is still on the roadmap. Intentional?' });
// Unpushed 1: refactor
note({ key: 'u1-1', origin: 'u1', file: 'src/orders.ts', side: 'new', from: 'const seen = new Set', to: 'seen.add(line.sku);', author: MIA, at: '2026-10-13T09:00:00Z',
  body: 'Nice catch on duplicates. Should two lines for the same SKU be merged instead of rejected?',
  replies: [
    { author: ALEX, at: '2026-10-13T09:40:00Z', body: 'Rejecting is simpler for now; merging changes the price semantics.' },
    { author: MIA, at: '2026-10-13T10:05:00Z', body: 'Fair. Let us note it in the README.' },
  ] });
note({ key: 'u1-2', origin: 'u1', file: 'src/orders.ts', side: 'old', from: 'if (line.unitPriceCents < 0)', author: ALEX, at: '2026-10-13T11:00:00Z', status: 'resolved',
  body: 'This does not catch NaN prices.',
  replies: [{ author: MIA, at: '2026-10-13T11:30:00Z', body: 'Fixed in this commit with `Number.isFinite`.' }] });
// Unpushed 2: rename
note({ key: 'u2-1', origin: 'u2', file: 'src/helpers.ts', side: 'new', from: 'export async function retry', to: 'throw lastError;', author: ALEX, at: '2026-10-20T08:30:00Z',
  body: [
    '**Retry behaviour** after this change:',
    '',
    '- delay doubles each attempt, capped at `maxDelayMs` (default 5000)',
    '- `shouldRetry` can stop early',
    '- the *last* error is rethrown',
    '',
    '```ts',
    'await retry(() => gateway.charge(id, cents), { attempts: 3, baseDelayMs: 200 });',
    '```',
    '',
    'Open question: should we add jitter so parallel callers do not retry in lockstep?',
  ].join('\n'),
  replies: [
    { author: MIA, at: '2026-10-20T09:00:00Z', body: 'Yes please, full jitter is the usual choice.' },
    { author: ALEX, at: '2026-10-20T09:15:00Z', body: 'OK, I will follow up in a separate commit.' },
    { author: MIA, at: '2026-10-20T09:20:00Z', body: 'Thanks. Also worth a unit test with fake timers.' },
  ] });
note({ key: 'u2-2', origin: 'u2', file: 'src/utils.ts', side: 'old', from: ".normalize('NFKD')", to: ".replace(/^-+|-+$/g, '')", author: MIA, at: '2026-10-20T10:00:00Z',
  body: 'Accents turned into dashes here ("café" became "caf-"). The new version strips combining marks first.' });
// Unpushed 3: delete
note({ key: 'u3-1', origin: 'u3', file: 'src/legacy.ts', side: 'old', from: 'const TAX_RATE', author: ALEX, at: '2026-10-27T09:00:00Z',
  body: 'Is tax handled anywhere else now that this file is gone?' });
// Unpushed 4: bugfix
note({ key: 'u4-1', origin: 'u4', file: 'src/inventory.ts', side: 'new', from: 'if (quantity > available) {', author: MIA, at: '2026-11-03T08:00:00Z',
  body: 'The old `available - 1` meant the **last unit** could never be reserved.\n\nAdd a test: reserve exactly `available` and expect success.' });
note({ key: 'u4-2', origin: 'u4', file: 'scripts/report.py', side: 'new', from: 'if not paid:', to: 'return 0.0', author: ALEX, at: '2026-11-03T09:30:00Z', body: LONG_BODY });
note({ key: 'u4-3', origin: 'u4', file: 'config/app.json', side: 'new', from: '"reservationTtlMinutes": 15', author: MIA, at: '2026-11-03T10:00:00Z', outdated: true,
  body: 'Is 15 minutes enough for slow card payments?' });
// Pushed
note({ key: 'c2-1', origin: 'c2', file: 'src/orders.ts', side: 'new', from: 'export function applyCoupon', to: 'return Math.round(subtotalCents * rate);', author: ALEX, at: '2026-10-06T08:00:00Z',
  body: 'Coupons are case-insensitive but the README does not say which code is which rate. Worth a table.' });
note({ key: 'c2-2', origin: 'c2', file: 'src/orders.ts', side: 'old', from: 'totalCents: calculateTotal(lines),', author: MIA, at: '2026-10-06T09:00:00Z',
  body: 'calculateTotal is now called twice per order. Cache it in a local?' });
note({ key: 'c1-1', origin: 'c1', file: 'README.md', side: 'new', from: 'Install Node 20 or newer.', author: ALEX, at: '2026-10-02T10:00:00Z',
  body: 'Add the Python version requirement here too (3.8+).' });

const comments = specs.map((s) => {
  const origin = shas[s.origin] || s.origin;
  const lines = splitLines(sideText(origin, s.file, s.side));
  const startIdx = lines.findIndex((l) => l.includes(s.from));
  if (startIdx < 0) {
    throw new Error('note ' + s.key + ': text not found: ' + s.from);
  }
  let endIdx = startIdx;
  if (s.to) {
    endIdx = lines.findIndex((l, i) => i >= startIdx && l.includes(s.to));
    if (endIdx < 0) {
      throw new Error('note ' + s.key + ': end text not found: ' + s.to);
    }
  }
  const c = {
    id: uuid(s.key),
    author: s.author.name,
    createdAt: s.at,
    body: s.body,
    replies: (s.replies || []).map((r, i) => ({ id: uuid(s.key + ':r' + i), author: r.author.name, createdAt: r.at, body: r.body })),
    status: s.status || 'open',
    file: s.file,
    side: s.side,
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    snippet: extractSnippet(lines, startIdx + 1, endIdx + 1),
    origin,
  };
  if (s.outdated) {
    c.outdated = true;
  }
  return c;
});

const notesDir = path.join(sandbox, '.git', 'diff-notes');
fs.mkdirSync(notesDir, { recursive: true });
fs.writeFileSync(path.join(notesDir, 'comments.json'), JSON.stringify({ version: 1, comments }, null, 2) + '\n');

console.log('sandbox created at ' + sandbox + ' (' + comments.length + ' notes)');
