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

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension<SpeclogApi>('geometrica.speclog');
  assert.ok(ext, 'extension geometrica.speclog is installed');
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

/** The written argument, once the process has written it. */
async function readWhenWritten(file: string): Promise<string> {
  await waitFor(`the agent command to write ${file}`, () => fs.existsSync(file) && fs.statSync(file).size > 0);
  await new Promise((r) => setTimeout(r, 300));
  return fs.readFileSync(file, 'utf8');
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
  await vscode.env.clipboard.writeText('');
  assert.strictEqual(await send(b1), 'sent');
  const prompt = await vscode.env.clipboard.readText();
  assert.ok(prompt.includes('B1') && prompt.includes('Task: B1'), prompt);
  assert.ok(prompt.includes(note) && prompt.includes('\n'), 'the note, unchanged, in a prompt of several lines');
  console.log('ok - the clipboard target copies the prompt');

  await vscode.env.clipboard.writeText('');
  await vscode.commands.executeCommand('speclog.copyAgentPrompt', b1);
  assert.strictEqual(await vscode.env.clipboard.readText(), prompt);
  console.log('ok - speclog.copyAgentPrompt copies the same prompt');

  // Command palette: the panel's selection, and only an item.
  await vscode.env.clipboard.writeText('');
  await detailsOf(b1);
  assert.strictEqual(await vscode.commands.executeCommand<string>('speclog.sendToAgent'), 'sent');
  assert.strictEqual(await vscode.env.clipboard.readText(), prompt);
  await detailsOf(tree.children[0].key);
  assert.strictEqual(await vscode.commands.executeCommand<string>('speclog.sendToAgent'), 'refused', 'a repository row');
  console.log('ok - the palette command sends the selected item, never a repository');

  await setAgent('target', 'terminal');
  await setAgent('terminalCommand', ['no-such-agent-xyz']);
  assert.strictEqual(await send(b1), 'refused');
  assert.strictEqual(speclogTerminals().length, before, 'no terminal without the command');
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
    assert.strictEqual(await send(b1), 'sent');
    await waitFor('terminal "Speclog: B1"', () => vscode.window.terminals.some((t) => t.name === 'Speclog: B1'));
    assert.strictEqual(await readWhenWritten(out), prompt, 'the full prompt arrives unchanged as one argument');
    await closeSpeclogTerminals();
    console.log('ok - the terminal target opens "Speclog: B1" and passes the prompt unchanged');

    const outLong = path.join(tempDir(), 'arg.txt');
    await setAgent('terminalCommand', ['node', '-e', writeArg(outLong)]);
    await setAgent('promptTemplate', `${'x'.repeat(4100)} {id} {note}`);
    assert.strictEqual(await send(b1), 'sent');
    const arg = await readWhenWritten(outLong);
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
      assert.strictEqual(await send(b1), 'sent');
      const c = PROMPT_FILE_ARG.exec(await readWhenWritten(outCmd));
      assert.ok(c, 'one-line prompt-file argument');
      assert.strictEqual(fs.readFileSync(c[1], 'utf8'), prompt, 'the prompt file holds the full prompt');
      await closeSpeclogTerminals();
      console.log('ok - a .cmd launcher gets the prompt through a prompt file');
    }
  }
  await setAgent('terminalCommand', undefined);
  await setAgent('target', undefined);
}
