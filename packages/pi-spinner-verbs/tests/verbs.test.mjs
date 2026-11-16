import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
let entry;
try { entry = require.resolve('@earendil-works/pi-coding-agent'); }
catch { entry = join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent/dist/index.js'); }
const { createJiti } = createRequire(entry)('jiti');
const factory = await createJiti(import.meta.url).import(fileURLToPath(new URL('../extensions/spinner-verbs/index.ts', import.meta.url)), { default: true });
const base = JSON.parse(readFileSync(new URL('../spinner-verbs/claude-code.json', import.meta.url), 'utf8'));
const breakingBad = JSON.parse(readFileSync(new URL('../spinner-verbs/breaking-bad.json', import.meta.url), 'utf8'));
const VERB = Symbol.for('pi-spinner-verbs.verb');

function fixture(flag) {
  const handlers = new Map();
  const commands = new Map();
  const notices = [];
  const messages = [];
  factory({
    registerFlag() {}, getFlag: () => flag,
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: (name, command) => commands.set(name, command),
  });
  const ctx = { cwd: process.cwd(), ui: { notify: (text) => notices.push(text), setWorkingMessage: (text) => messages.push(text) } };
  return { handlers, commands, notices, messages, ctx };
}

async function withRandom(value, action) {
  const original = Math.random;
  try { Math.random = () => value; return await action(); }
  finally { Math.random = original; }
}

test('Claude Code base is complete and is the default without a theme', async () => {
  assert.equal(base.length, 185);
  assert.equal(new Set(base).size, 185);
  assert.equal(base[0], 'Accomplishing');
  assert.equal(base.at(-1), 'Zigzagging');
  const f = fixture('(default)');
  await withRandom(0, () => f.handlers.get('session_start')({}, f.ctx));
  assert.equal(globalThis[VERB], base[0]);
  await f.commands.get('verb-status').handler('', f.ctx);
  assert.match(f.notices.at(-1), /185 verbs.*claude-code/);
});

test('Breaking Bad appends to the base, and verbs change only on model turns', async () => {
  const f = fixture('breaking-bad');
  await withRandom(0, () => f.handlers.get('session_start')({}, f.ctx));
  assert.equal(globalThis[VERB], base[0]);
  await withRandom(0.999999, () => f.handlers.get('turn_start')({}, f.ctx));
  assert.equal(globalThis[VERB], breakingBad.at(-1));
  assert.equal(f.handlers.has('tool_execution_start'), false);
  await f.commands.get('verb-status').handler('', f.ctx);
  assert.match(f.notices.at(-1), /258 verbs.*claude-code \+ breaking-bad/);
  await withRandom(0.999999, () => f.commands.get('verbs').handler('(default)', f.ctx));
  assert.equal(globalThis[VERB], base.at(-1));
});

test('custom lists are appended and deduplicated; invalid values fall back safely', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-spinner-verbs-test-'));
  try {
    mkdirSync(join(dir, '.pi'));
    writeFileSync(join(dir, '.pi/settings.json'), JSON.stringify({ spinnerVerbsFile: 'verbs.json' }));
    writeFileSync(join(dir, '.pi/verbs.json'), JSON.stringify([base[0], 'Custom verb', 'Custom verb']));
    const f = fixture(); f.ctx.cwd = dir;
    await withRandom(0.999999, () => f.handlers.get('session_start')({}, f.ctx));
    assert.equal(globalThis[VERB], 'Custom verb');
    await f.commands.get('verb-status').handler('', f.ctx);
    assert.match(f.notices.at(-1), /186 verbs/);
    writeFileSync(join(dir, '.pi/verbs.json'), JSON.stringify([null, 42, '']));
    await withRandom(0, () => f.handlers.get('session_start')({}, f.ctx));
    assert.equal(globalThis[VERB], base[0]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('pi-polish consumes the verb without competing working-message writes', async () => {
  const consumer = Symbol.for('pi-spinner-verbs.verb.consumer');
  const original = globalThis[consumer];
  try {
    globalThis[consumer] = true;
    const f = fixture('breaking-bad');
    await f.handlers.get('session_start')({}, f.ctx);
    assert.ok([...base, ...breakingBad].includes(globalThis[VERB]));
    assert.equal(f.messages.length, 0);
  } finally {
    if (original === undefined) delete globalThis[consumer];
    else globalThis[consumer] = original;
    delete globalThis[VERB];
  }
});
