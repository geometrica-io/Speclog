// Hosts the core Engine in the extension process: settings -> engine, engine state -> status bar
// and panel. The panel is a placeholder until the webview UI lands (it shows the posted summary).
import * as vscode from 'vscode';
import { Engine, EngineState, gitVersion } from '@speclog/core';
import { SECTION, readEngineConfig } from './settings';
import { SpeclogStatusBar } from './statusBar';
import { Summary, summarize } from './summary';

/** Messages to the webview (placeholder; the full protocol replaces it). */
export type HostToWebview = {
  type: 'state';
  summary: Summary;
  busy: boolean;
  attention: number;
  discoveryErrors: number;
  engineError: string;
};

/** globalState keys: per-repository data, keyed by repository key (origin URL or absolute path). */
const TRUST_KEY = 'speclog.trustCommits';
const HIDDEN_KEY = 'speclog.hiddenRepos';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class SpeclogHost implements vscode.Disposable {
  private engine: Engine | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private last: HostToWebview | undefined;
  private readonly statusBar = new SpeclogStatusBar();
  private readonly subscriptions: vscode.Disposable[] = [];
  private starting: Promise<void> | undefined;
  private gitErrorShown = false;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.subscriptions.push(
      this.statusBar,
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(SECTION)) this.reconfigure();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.reconfigure()),
    );
  }

  /** Checks git, then starts the engine. Missing or old git: one error notification, error status. */
  start(): Promise<void> {
    if (!this.starting) this.starting = this.doStart().finally(() => { this.starting = undefined; });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    if (this.engine || this.disposed) return;
    const git = await gitVersion();
    if (this.disposed) return;
    if (!git.ok) {
      this.statusBar.gitMissing();
      if (!this.gitErrorShown) {
        this.gitErrorShown = true;
        void vscode.window.showErrorMessage(vscode.l10n.t('Speclog: git 2.24 or newer was not found ({0}).', git.error));
      }
      return;
    }
    const engine = new Engine(readEngineConfig(this.trustCommits()));
    this.engine = engine;
    this.subscriptions.push(engine.onDidChange((s) => this.onState(s)));
    engine.start();
  }

  /** Opens the Speclog panel, or brings it to the front. */
  open(): void {
    if (this.disposed) return;
    if (this.panel) {
      this.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('speclog', vscode.l10n.t('Speclog'), vscode.ViewColumn.Active, {
      enableScripts: false,
      localResourceRoots: [],
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'speclog.svg');
    panel.onDidDispose(() => { this.panel = undefined; });
    this.panel = panel;
    this.render();
  }

  /** Sends a message to the panel (no-op while it is closed; the latest one is shown on open). */
  post(msg: HostToWebview): void {
    this.last = msg;
    this.render();
  }

  /** Rediscovers and rebuilds every repository; retries the git check if it failed. */
  refresh(): void {
    if (this.engine) this.engine.refresh();
    else void this.start();
  }

  trustCommits(): Record<string, string> {
    return { ...this.context.globalState.get<Record<string, string>>(TRUST_KEY, {}) };
  }

  /** Sets (or, with no commit, removes) a repository's trust cutoff and rescans. */
  async setTrustCommit(repoKey: string, commit: string | undefined): Promise<void> {
    const all = this.trustCommits();
    if (commit) all[repoKey] = commit;
    else delete all[repoKey];
    await this.context.globalState.update(TRUST_KEY, all);
    this.reconfigure();
  }

  hiddenRepos(): string[] {
    return [...this.context.globalState.get<string[]>(HIDDEN_KEY, [])];
  }

  async setHiddenRepos(keys: string[]): Promise<void> {
    await this.context.globalState.update(HIDDEN_KEY, [...new Set(keys)]);
  }

  /** Test hooks. */
  get statusText(): string {
    return this.statusBar.text;
  }
  get panelOpen(): boolean {
    return this.panel !== undefined;
  }
  get lastPosted(): HostToWebview | undefined {
    return this.last;
  }

  private reconfigure(): void {
    this.engine?.updateConfig(readEngineConfig(this.trustCommits()));
  }

  private onState(s: EngineState): void {
    if (this.disposed) return;
    const summary = summarize(s);
    this.statusBar.update(summary);
    this.post({
      type: 'state',
      summary,
      busy: s.busy,
      attention: s.attention.length,
      discoveryErrors: s.discoveryErrors.length,
      engineError: s.engineError,
    });
  }

  private render(): void {
    if (!this.panel) return;
    const body = this.last
      ? escapeHtml(JSON.stringify(this.last, null, 2))
      : escapeHtml(vscode.l10n.t('Scanning repositories…'));
    this.panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Speclog</title>
</head>
<body><pre>${body}</pre></body>
</html>`;
  }

  /** Stops the engine (waits for a running fetch, bounded by the engine). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.subscriptions.splice(0)) d.dispose();
    this.panel?.dispose();
    const engine = this.engine;
    this.engine = undefined;
    if (engine) await engine.dispose();
  }
}
