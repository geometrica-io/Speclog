// Runs inside VS Code (see runTest.ts): the extension activates, speclog.open opens the panel,
// and the status bar shows the counts of the two sample repositories; then Send to agent.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { resolveExecutable } from '../src/agentPure';
import type { SpeclogApi } from '../src/extension';

const WAIT_MS = 60000;

async function waitFor(what: string, cond: () => boolean): Promise<void> {
  const end = Date.now() + WAIT_MS;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Writes a unique sentinel to the clipboard and reads it back (OS clipboard writes can silently fail under contention). */
async function primeClipboard(): Promise<string> {
  const sentinel = `speclog-smoke-${Math.random().toString(36).slice(2)}`;
  for (let i = 0; i < 20; i++) {
    await vscode.env.clipboard.writeText(sentinel);
    if ((await vscode.env.clipboard.readText()) === sentinel) return sentinel;
    await sleep(100);
  }
  throw new Error('the clipboard never took the sentinel text');
}

/** The clipboard text once it is no longer the sentinel. */
async function clipboardAfter(sentinel: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const text = await vscode.env.clipboard.readText();
    if (text !== sentinel) return text;
    await sleep(100);
  }
  throw new Error('the clipboard never changed from the sentinel: the action did not write it');
}

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<SpeclogApi>('geometricaio.speclog');
  assert.ok(ext, 'extension geometricaio.speclog is installed');
  const api = await ext.activate();
  assert.ok(ext.isActive, 'extension is active');
  console.log('ok - the extension activates');

  assert.strictEqual(vscode.workspace.workspaceFolders?.length, 2, 'two workspace folders');

  await vscode.commands.executeCommand('speclog.open');
  assert.ok(api.isPanelOpen(), 'panel is open');
  await waitFor('a Speclog webview tab', () => vscode.window.tabGroups.all.flatMap((g) => g.tabs)
    .some((t) => t.label === 'Speclog' && t.input instanceof vscode.TabInputWebview));
  console.log('ok - speclog.open opens the panel');

  await waitFor('status bar "Speclog: 1/2"', () => api.getStatusText().includes('Speclog: 1/2'));
  console.log(`ok - status bar: ${api.getStatusText()}`);

  await waitFor('the webview script to send "ready"', () => api.webviewReady());
  console.log('ok - the webview script runs under the CSP');

  type Posted = { type: string; summary: { repos: number; done: number; items: number }; tree: { children: { kind: string; label: string }[] } };
  await waitFor('a state message with two repositories', () => {
    const p = api.lastPosted() as Posted | undefined;
    return p?.type === 'state' && p.tree.children.length === 2;
  });
  const posted = api.lastPosted() as Posted;
  assert.deepStrictEqual([posted.summary.repos, posted.summary.done, posted.summary.items], [2, 1, 2]);
  // Folder names are alpha_<random>, beta_<random>.
  const nodes = posted.tree.children;
  assert.ok(nodes.every((c) => c.kind === 'branch'), 'repository nodes are branches');
  assert.ok(nodes[0].label.startsWith('alpha') && nodes[1].label.startsWith('beta'), nodes.map((c) => c.label).join(', '));
  console.log('ok - the panel receives the state; the tree has 2 repository nodes');

  // Sort: the Time view groups by last activity, newest first. Both items were created 2026-01-01; A1 also
  // has its closing commit (a later date), so it leads with Last activity ↓.
  type TimeState = {
    type: string; sort?: string; view: string; ui: { openKeys: string[] };
    tree: TreeDto & { children: (TreeDto & { children: TreeDto[] })[] };
  };
  const latest = () => api.lastPosted() as TimeState;
  await api.receive({ type: 'setView', view: 'time' });
  await waitFor('a Time state', () => latest()?.type === 'state' && latest().view === 'time');
  const a1Key = itemKey(latest().tree, 'A1');
  assert.ok(a1Key, 'A1 is in the Time view');
  await api.receive({ type: 'select', key: a1Key });
  await api.receive({ type: 'setSort', sort: 'activity-desc' });
  await waitFor('a Time state sorted by last activity', () => latest()?.type === 'state' && latest().sort === 'activity-desc');
  const timed = latest();
  const days = timed.tree.children.flatMap((m) => m.children.map((d) => d.key));
  const first = timed.tree.children[0].children[0].key;
  assert.strictEqual(first, [...days].sort().reverse()[0], 'the newest day group comes first');
  assert.notStrictEqual(first, 't/2026-01/2026-01-01', 'A1 is grouped by its commit, not its created date');
  assert.ok(timed.ui.openKeys.includes(first), "the selected item's new day group is opened");
  await api.receive({ type: 'setSort', sort: 'nonsense' });
  await api.receive({ type: 'setView', view: 'area' });
  await waitFor('an Area state that kept the sort', () => latest()?.view === 'area');
  assert.strictEqual(latest().sort, 'activity-desc', 'an unknown sort is ignored');
  await api.receive({ type: 'setSort', sort: 'created-asc' });
  await api.receive({ type: 'setView', view: 'program' });
  await waitFor('back to Program, created ↑', () => latest()?.view === 'program' && latest().sort === 'created-asc');
  console.log('ok - the Sort combobox orders the Time view by last activity');

  // Trust and hook commands with an explicit repository key (the Attention button path).
  const state = api.lastPosted() as unknown as { repos: { key: string; name: string }[] };
  const alpha = state.repos.find((r) => r.name.startsWith('alpha'));
  assert.ok(alpha, 'alpha is in the repository list');
  await vscode.commands.executeCommand('speclog.trustTaskFiles', alpha.key);
  assert.match(api.trustCommits()[alpha.key] ?? '', /^[0-9a-f]{40,64}$/, 'trust stores the full main-tip hash');
  console.log('ok - speclog.trustTaskFiles stores the main tip of the chosen repository');
  await vscode.commands.executeCommand('speclog.untrustTaskFiles', alpha.key);
  assert.strictEqual(api.trustCommits()[alpha.key], undefined, 'untrust removes it');
  console.log('ok - speclog.untrustTaskFiles removes it');

  const alphaDir = vscode.workspace.workspaceFolders!.map((f) => f.uri.fsPath).find((p) => path.basename(p).startsWith('alpha'))!;
  await vscode.commands.executeCommand('speclog.installHook', alpha.key);
  const hook = path.join(alphaDir, '.git', 'hooks', 'commit-msg');
  await waitFor('the installed hook', () => fs.existsSync(hook));
  assert.ok(fs.readFileSync(hook, 'utf8').includes('Speclog commit-msg hook'), 'hook content');
  console.log('ok - speclog.installHook installs the hook');

  await vscode.commands.executeCommand('speclog.openReport');
  await waitFor('a Speclog Report webview tab', () => vscode.window.tabGroups.all.flatMap((g) => g.tabs)
    .some((t) => t.label === 'Speclog Report' && t.input instanceof vscode.TabInputWebview));
  await waitFor('a report of both sample repositories', () => api.lastReportRepoCount() === 2);
  console.log('ok - speclog.openReport opens the report tab and computes both repositories');
  // The report tab covers the board, whose hidden webview stops taking messages: close it, show the board.
  const reportTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => t.label === 'Speclog Report');
  await vscode.window.tabGroups.close(reportTabs);
  await vscode.commands.executeCommand('speclog.open');

  await agentTests(api);
}

// ------------------------------------------------------------------------------------------ send to agent

type TreeDto = { key: string; kind: string; id?: string; children: TreeDto[] };
type DetailsMsg = { key: string; details: { note: string; agent: { enabled: boolean; reason: string } } };

function itemKey(tree: TreeDto, id: string): string | undefined {
  if (tree.kind === 'item' && tree.id === id) return tree.key;
  for (const c of tree.children) {
    const k = itemKey(c, id);
    if (k) return k;
  }
  return undefined;
}

async function setAgent(name: string, value: unknown): Promise<void> {
  await vscode.workspace.getConfiguration('speclog').update(`agent.${name}`, value, vscode.ConfigurationTarget.Global);
}

const speclogTerminals = () => vscode.window.terminals.filter((t) => t.name.startsWith('Speclog: '));

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'speclog-smoke-'));
}

/** How long a launched agent terminal gets to write its file before it counts as never started. */
const LAUNCH_MS = 20000;

/**
 * Sends the item and returns what the agent command wrote to file. Under machine load VS Code's terminal
 * host can stall ("No ptyHost heartbeat after 6 seconds" in the log): the terminal exists but its process
 * never starts. Such an attempt is closed and the send is retried once; every send must still be 'sent'.
 */
async function sendAndRead(sendItem: () => PromiseLike<string>, file: string, terminalName?: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    assert.strictEqual(await sendItem(), 'sent');
    const end = Date.now() + LAUNCH_MS;
    // The terminal closes when the command exits, so it is looked for while waiting, not afterwards.
    let sawTerminal = false;
    while (Date.now() < end) {
      sawTerminal ||= !terminalName || vscode.window.terminals.some((t) => t.name === terminalName);
      if (fs.existsSync(file) && fs.statSync(file).size > 0) {
        assert.ok(sawTerminal, `terminal "${terminalName}"`);
        await sleep(300); // let the writer finish
        return fs.readFileSync(file, 'utf8');
      }
      await sleep(50);
    }
    if (attempt >= 2) throw new Error(`timed out waiting for the agent command to write ${file} (2 attempts)`);
    console.log(`retry - the agent terminal did not start within ${LAUNCH_MS / 1000} s (VS Code terminal host busy)`);
    await closeSpeclogTerminals();
  }
}

async function closeSpeclogTerminals(): Promise<void> {
  for (const t of speclogTerminals()) t.dispose();
  await waitFor('Speclog terminals to close', () => speclogTerminals().length === 0);
}

/** `node` from PATH (process.execPath is Electron here). */
function nodeOnPath(): string | undefined {
  return resolveExecutable('node', process.env.PATH ?? '', process.env.PATHEXT ?? '', process.platform,
    (p) => fs.existsSync(p) && fs.statSync(p).isFile());
}

/** A node -e script that writes its last argument to out. */
const writeArg = (out: string) => `require("fs").writeFileSync(${JSON.stringify(out)}, process.argv.at(-1))`;

const PROMPT_FILE_ARG = /^Read the task in (.+) and follow it\.$/;

async function agentTests(api: SpeclogApi): Promise<void> {
  api.receive({ type: 'preset', preset: 'all' });
  await waitFor('a state with A1 and B1', () => {
    const p = api.lastPosted() as { type: string; tree: TreeDto } | undefined;
    return p?.type === 'state' && !!itemKey(p.tree, 'A1') && !!itemKey(p.tree, 'B1');
  });
  const tree = (api.lastPosted() as { tree: TreeDto }).tree;
  const a1 = itemKey(tree, 'A1')!;
  const b1 = itemKey(tree, 'B1')!;
  const send = (key: string) => vscode.commands.executeCommand<string>('speclog.sendToAgent', key);
  const detailsOf = async (key: string): Promise<DetailsMsg> => {
    api.receive({ type: 'select', key });
    await waitFor(`details of ${key}`, () => (api.lastDetails() as DetailsMsg | undefined)?.key === key);
    return api.lastDetails() as DetailsMsg;
  };

  const da1 = await detailsOf(a1);
  assert.strictEqual(da1.details.agent.enabled, false, 'a done item cannot be sent');
  assert.strictEqual(da1.details.agent.reason, 'The item is already done.', 'with a reason worded by the host');
  const db1 = await detailsOf(b1);
  assert.strictEqual(db1.details.agent.enabled, true, 'an open item can be sent');
  const note = db1.details.note;
  assert.ok(note.includes('"hi"') && note.includes('%PATH%') && note.includes('`whoami`'), note);
  console.log('ok - details carry agent availability');

  await setAgent('target', 'terminal');
  const before = speclogTerminals().length;
  assert.strictEqual(await send(`${b1}\u0000gone`), 'refused', 'an unknown key is refused');
  assert.strictEqual(speclogTerminals().length, before, 'no terminal for an unknown key');
  console.log('ok - sendToAgent re-resolves the item');

  assert.strictEqual(await send(a1), 'refused');
  assert.strictEqual(speclogTerminals().length, before, 'no terminal for a done item');
  console.log('ok - a done item is refused');

  await setAgent('target', 'clipboard');
  const s1 = await primeClipboard();
  assert.strictEqual(await send(b1), 'sent');
  const prompt = await clipboardAfter(s1);
  assert.ok(prompt.includes('B1') && prompt.includes('Task: B1'), prompt);
  assert.ok(prompt.includes(note) && prompt.includes('\n'), 'the note, unchanged, in a prompt of several lines');
  console.log('ok - the clipboard target copies the prompt');

  const s2 = await primeClipboard();
  await vscode.commands.executeCommand('speclog.copyAgentPrompt', b1);
  assert.strictEqual(await clipboardAfter(s2), prompt);
  console.log('ok - speclog.copyAgentPrompt copies the same prompt');

  // Command palette: the panel's selection, and only an item.
  const s3 = await primeClipboard();
  await detailsOf(b1);
  assert.strictEqual(await vscode.commands.executeCommand<string>('speclog.sendToAgent'), 'sent');
  assert.strictEqual(await clipboardAfter(s3), prompt);
  await detailsOf(tree.children[0].key);
  assert.strictEqual(await vscode.commands.executeCommand<string>('speclog.sendToAgent'), 'refused', 'a repository row');
  console.log('ok - the palette command sends the selected item, never a repository');

  await setAgent('target', 'terminal');
  await setAgent('terminalCommand', ['no-such-agent-xyz']);
  assert.strictEqual(await send(b1), 'refused');
  assert.strictEqual(speclogTerminals().length, before, 'no terminal without the command');
  await setAgent('terminalCommand', [path.join(tempDir(), 'missing-agent.exe')]);
  assert.strictEqual(await send(b1), 'refused', 'a missing absolute command is refused');
  assert.strictEqual(speclogTerminals().length, before, 'no terminal for a missing absolute command');
  console.log('ok - a missing agent command is reported');

  for (const bad of [['./bin/agent'], [], [''], 'claude']) {
    await setAgent('terminalCommand', bad);
    assert.strictEqual(await send(b1), 'refused', `terminalCommand ${JSON.stringify(bad)} is refused`);
    assert.strictEqual(speclogTerminals().length, before, 'no terminal for an invalid command');
  }
  console.log('ok - a relative, empty or malformed terminalCommand is refused, never defaulted');

  const node = nodeOnPath();
  if (!node) {
    console.log('skip - terminal target: `node` is not on PATH in the test host');
  } else {
    const out = path.join(tempDir(), 'arg.txt');
    await setAgent('terminalCommand', ['node', '-e', writeArg(out)]);
    assert.strictEqual(await sendAndRead(() => send(b1), out, 'Speclog: B1'), prompt,
      'the full prompt arrives unchanged as one argument');
    await closeSpeclogTerminals();
    console.log('ok - the terminal target opens "Speclog: B1" and passes the prompt unchanged');

    const outLong = path.join(tempDir(), 'arg.txt');
    await setAgent('terminalCommand', ['node', '-e', writeArg(outLong)]);
    await setAgent('promptTemplate', `${'x'.repeat(4100)} {id} {note}`);
    const arg = await sendAndRead(() => send(b1), outLong);
    const m = PROMPT_FILE_ARG.exec(arg);
    assert.ok(m, arg);
    assert.strictEqual(fs.readFileSync(m[1], 'utf8'), `${'x'.repeat(4100)} B1 ${note}`, 'the prompt file holds the prompt');
    await setAgent('promptTemplate', undefined);
    await closeSpeclogTerminals();
    console.log('ok - a long prompt goes through a prompt file');

    if (process.platform === 'win32') {
      // A .cmd launcher (npm installs claude.cmd) gets the prompt through a file.
      const dir = tempDir();
      const script = path.join(dir, 'write-arg.js');
      const outCmd = path.join(dir, 'arg.txt');
      fs.writeFileSync(script, writeArg(outCmd));
      const launcher = path.join(dir, 'fake-agent.cmd');
      fs.writeFileSync(launcher, `@"${node}" "${script}" %*\r\n`);
      await setAgent('terminalCommand', [launcher]);
      const c = PROMPT_FILE_ARG.exec(await sendAndRead(() => send(b1), outCmd));
      assert.ok(c, 'one-line prompt-file argument');
      assert.strictEqual(fs.readFileSync(c[1], 'utf8'), prompt, 'the prompt file holds the full prompt');
      await closeSpeclogTerminals();
      console.log('ok - a .cmd launcher gets the prompt through a prompt file');
    }
  }
  await setAgent('terminalCommand', undefined);
  await setAgent('target', undefined);
}
