// Runs inside VS Code (see runTest.ts): the extension activates, speclog.open opens the panel,
// and the status bar shows the counts of the two sample repositories.
import * as assert from 'assert';
import * as vscode from 'vscode';
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
}
