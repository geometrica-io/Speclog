// Command registrations: open / refresh, the commit-msg hook installer, the per-repository trust cutoff and
// Send to agent.
import * as vscode from 'vscode';
import { SendResult, copyAgentPrompt, sendToAgent } from './agent';
import { HookError, hooksPathOf, installHook, resolveCommit } from './hook';
import type { SpeclogHost } from './host';

type RepoInfo = ReturnType<SpeclogHost['repoInfos']>[number];

/** The repository named by the argument (a repository key), else the only one, else the user's pick. */
async function chooseRepo(host: SpeclogHost, key: unknown, placeHolder: string, only?: (r: RepoInfo) => boolean): Promise<RepoInfo | undefined> {
  let repos = host.repoInfos();
  if (only) repos = repos.filter(only);
  if (typeof key === 'string') return repos.find((r) => r.key === key);
  if (repos.length === 0) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: no repositories were found.'));
    return undefined;
  }
  if (repos.length === 1) return repos[0];
  const pick = await vscode.window.showQuickPick(
    repos.map((r) => ({ label: r.name, description: r.path, repo: r })), { placeHolder });
  return pick?.repo;
}

async function installHookCommand(host: SpeclogHost, key: unknown): Promise<void> {
  const repo = await chooseRepo(host, key, vscode.l10n.t('Install the commit-msg hook in which repository?'));
  if (!repo) return;
  try {
    const result = await installHook(repo.path);
    switch (result) {
      case 'installed':
        void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: commit-msg hook installed in {0}.', repo.name));
        break;
      case 'chained':
        void vscode.window.showInformationMessage(
          vscode.l10n.t('Speclog: commit-msg hook installed in {0}; the existing hook was kept as commit-msg.local and still runs.', repo.name));
        break;
      case 'already':
        void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: the commit-msg hook is already installed in {0}.', repo.name));
        break;
      case 'skipped-hooksPath':
        void vscode.window.showWarningMessage(vscode.l10n.t(
          'Speclog: {0} sets core.hooksPath ({1}); the hook was not installed. Add it to that hooks folder yourself.',
          repo.name, await hooksPathOf(repo.path)));
        break;
    }
  } catch (e) {
    const why = e instanceof HookError && e.code === 'bothHooksExist'
      ? vscode.l10n.t('both commit-msg and commit-msg.local already exist; nothing was changed')
      : e instanceof HookError ? vscode.l10n.t('this is not a git repository') : e instanceof Error ? e.message : String(e);
    void vscode.window.showErrorMessage(vscode.l10n.t('Speclog: the hook could not be installed in {0}: {1}', repo.name, why));
  }
}

async function trustCommand(host: SpeclogHost, key: unknown): Promise<void> {
  const repo = await chooseRepo(host, key, vscode.l10n.t('Trust the current task files of which repository?'));
  if (!repo) return;
  const hash = await resolveCommit(repo.path, repo.tipRef);
  if (!hash) {
    void vscode.window.showWarningMessage(vscode.l10n.t('Speclog: {0} has no main branch to trust.', repo.name));
    return;
  }
  await host.setTrustCommit(repo.key, hash);
  void vscode.window.showInformationMessage(vscode.l10n.t('Trusting task files in {0} as of {1}', repo.name, hash.slice(0, 7)));
}

async function untrustCommand(host: SpeclogHost, key: unknown): Promise<void> {
  const trusted = host.trustCommits();
  const repo = await chooseRepo(host, key, vscode.l10n.t('Stop trusting the task files of which repository?'), (r) => r.key in trusted);
  if (!repo) return;
  await host.setTrustCommit(repo.key, undefined);
  void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: no longer trusting task files in {0}.', repo.name));
}

/** The tree key from the argument (panel), else the panel's selection (command palette); "" when none. */
function agentKey(host: SpeclogHost, key: unknown): string {
  return typeof key === 'string' ? key : host.selectedItemKey;
}

function selectFirst(): void {
  void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: select an item in the Speclog panel first.'));
}

async function sendCommand(ctx: vscode.ExtensionContext, host: SpeclogHost, arg: unknown): Promise<SendResult> {
  const key = agentKey(host, arg);
  const w = host.workspace;
  if (!w || key === '') {
    selectFirst();
    return 'refused';
  }
  return sendToAgent(ctx, w, key);
}

async function copyPromptCommand(host: SpeclogHost, arg: unknown): Promise<void> {
  const key = agentKey(host, arg);
  const w = host.workspace;
  if (!w || key === '') {
    selectFirst();
    return;
  }
  await copyAgentPrompt(w, key);
}

export function registerCommands(ctx: vscode.ExtensionContext, host: SpeclogHost): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('speclog.open', () => host.open()),
    vscode.commands.registerCommand('speclog.refresh', () => host.refresh()),
    vscode.commands.registerCommand('speclog.installHook', (key?: unknown) => installHookCommand(host, key)),
    vscode.commands.registerCommand('speclog.trustTaskFiles', (key?: unknown) => trustCommand(host, key)),
    vscode.commands.registerCommand('speclog.untrustTaskFiles', (key?: unknown) => untrustCommand(host, key)),
    vscode.commands.registerCommand('speclog.sendToAgent', (key?: unknown) => sendCommand(ctx, host, key)),
    vscode.commands.registerCommand('speclog.copyAgentPrompt', (key?: unknown) => copyPromptCommand(host, key)),
  ];
}
