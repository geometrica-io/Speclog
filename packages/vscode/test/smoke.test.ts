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

  const posted = api.lastPosted() as { type: string; summary: { repos: number; done: number; total: number } } | undefined;
  assert.ok(posted, 'the panel received a state message');
  assert.strictEqual(posted.type, 'state');
  assert.deepStrictEqual([posted.summary.repos, posted.summary.done, posted.summary.total], [2, 1, 2]);
  console.log('ok - the panel receives the state');
}
