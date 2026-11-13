// Hosts the core Engine in the extension process: settings -> engine, engine state -> status bar and
// the Speclog panel. The host builds the tree and every DTO; the webview only renders them and sends
// intents (see protocol.ts).
import * as fs from 'fs';
import * as vscode from 'vscode';
import {
  ALL_STATUSES, Engine, EngineState, Filter, TreeNode, applyPreset, buildTree, countByStatus, findItem,
  gitVersion, matches,
} from '@speclog/core';
import {
  attentionToDto, branchSummary, filterFromDto, filterToDto, findNode, findRepoNode, itemDetails, keyOfItem, pathToKey,
  pruneOpenKeys, toTreeDto,
} from './dto';
import { clampLine, resolveInRepo } from './files';
import { FILTER_PRESETS } from './protocol';
import type { DetailsDto, FilterPreset, HostToWebview, Status, WebviewToHost } from './protocol';
import { SECTION, readEngineConfig } from './settings';
import { SpeclogStatusBar } from './statusBar';
import { translateCoreLabel, webviewStrings } from './strings';
import { summarize } from './summary';
import { COALESCE_MS, MAX_KEYS, PersistedUi, isKey, isStr, isView, num, readUi } from './uiState';

type StateMessage = Extract<HostToWebview, { type: 'state' }>;

/** globalState keys: per-repository data, keyed by repository key (origin URL or absolute path). */
const TRUST_KEY = 'speclog.trustCommits';
const HIDDEN_KEY = 'speclog.hiddenRepos';
/** workspaceState key of the panel's UI state. */
const UI_KEY = 'speclog.ui';

function nonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 32; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

export class SpeclogHost implements vscode.Disposable {
  private engine: Engine | undefined;
  private state: EngineState | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private panelSubscriptions: vscode.Disposable[] = [];
  /** The workspace the tree was last built from: a state with the same one only changes busy / fetch / Attention. */
  private builtFrom: EngineState['workspace'] | undefined;
  private pendingTimer: NodeJS.Timeout | undefined;
  private ready = false;
  private everReady = false;
  private last: StateMessage | undefined;
  private ui: PersistedUi;
  private search = '';
  private tree: TreeNode | undefined;
  private fullTree: TreeNode | undefined;
  private readonly statusBar = new SpeclogStatusBar();
  private readonly subscriptions: vscode.Disposable[] = [];
  private starting: Promise<void> | undefined;
  private gitErrorShown = false;
  private disposed = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.ui = readUi(context.workspaceState.get(UI_KEY));
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
    const dist = vscode.Uri.joinPath(this.context.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel('speclog', vscode.l10n.t('Speclog'), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [dist],
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'assets', 'speclog.svg');
    this.ready = false;
    this.panelSubscriptions = [
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.ready = false;
        for (const d of this.panelSubscriptions.splice(0)) d.dispose();
      }),
      panel.webview.onDidReceiveMessage((m: unknown) => { void this.onMessage(m); }),
      // A hidden webview is discarded; it sends "ready" again when shown.
      panel.onDidChangeViewState((e) => { if (!e.webviewPanel.visible) this.ready = false; }),
    ];
    this.panel = panel;
    panel.webview.html = this.html(panel.webview, dist);
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
    this.rebuild();
    this.postState(false);
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
  /** The webview script ran (under the CSP) and asked for its data. */
  get webviewReady(): boolean {
    return this.everReady;
  }

  private reconfigure(): void {
    this.engine?.updateConfig(readEngineConfig(this.trustCommits()));
  }

  private onState(s: EngineState): void {
    if (this.disposed) return;
    this.state = s;
    this.statusBar.update(summarize(s));
    if (!this.pendingTimer) this.pendingTimer = setTimeout(() => this.flushState(), COALESCE_MS);
  }

  /** Posts the newest engine state: the whole tree when the workspace changed, else a light status. */
  private flushState(): void {
    this.pendingTimer = undefined;
    const s = this.state;
    if (!s || this.disposed) return;
    if (s.workspace === this.builtFrom && this.last) {
      const attention = attentionToDto(s.attention, s.workspace);
      const fetch = this.fetchDto(s);
      this.last = { ...this.last, busy: s.busy, fetch, attention };
      this.send({ type: 'status', busy: s.busy, fetch, attention });
      return;
    }
    this.rebuild();
    this.postState(false);
    this.postDetails();
  }

  private fetchDto(s: EngineState): StateMessage['fetch'] {
    const nameOf = new Map(s.workspace.snapshots.map((x) => [x.repo.path, x.repo.name]));
    return s.fetch.map((x) => ({ repo: nameOf.get(x.repo) ?? x.repo, lastOkUnix: x.lastOkUnix, firstFailUnix: x.firstFailUnix,
      lastError: x.lastError }));
  }

  // ------------------------------------------------------------------------------------------ model

  private filter(): Filter {
    return filterFromDto({ statuses: this.ui.statuses, sizes: this.ui.sizes, hiddenRepos: this.hiddenRepos(), search: this.search });
  }

  private rebuild(): void {
    this.fullTree = undefined;
    this.builtFrom = this.state?.workspace;
    this.tree = this.state ? buildTree(this.state.workspace, this.ui.view, this.filter()) : undefined;
  }

  /** The unfiltered tree (dropped and hidden repositories included): details of any selected node. */
  private full(): TreeNode | undefined {
    if (!this.fullTree && this.state) this.fullTree = buildTree(this.state.workspace, this.ui.view, applyPreset('all'));
    return this.fullTree;
  }

  private buildState(reveal: boolean): StateMessage | undefined {
    const s = this.state;
    if (!s || !this.tree) return undefined;
    const ws = s.workspace;
    const f = this.filter();
    const byStatus = countByStatus(ws, f);
    const counts = Object.fromEntries(ALL_STATUSES.map((st) => [st, byStatus.get(st) ?? 0])) as Record<Status, number>;
    const sum = summarize(s);
    const repos = new Map<string, string>();
    for (const snap of ws.snapshots) if (!repos.has(snap.repo.key)) repos.set(snap.repo.key, snap.repo.name);
    return {
      type: 'state',
      view: this.ui.view,
      tree: toTreeDto(this.tree, translateCoreLabel),
      counts,
      summary: { repos: sum.repos, items: sum.total, done: sum.done, unverified: sum.unverified,
        shown: ws.items.filter((r) => matches(r, f)).length },
      attention: attentionToDto(s.attention, ws),
      busy: s.busy,
      fetch: this.fetchDto(s),
      filter: filterToDto(f),
      ui: {
        openKeys: [...this.ui.open[this.ui.view]], selectedKey: this.ui.selected[this.ui.view],
        attentionOpen: this.ui.attentionOpen, attentionHeight: this.ui.attentionHeight, treeFraction: this.ui.treeFraction, reveal,
      },
      repos: [...repos].map(([key, name]) => ({ key, name }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key)),
    };
  }

  private postState(reveal: boolean): void {
    const msg = this.buildState(reveal);
    if (!msg) return;
    this.last = msg;
    this.send(msg);
  }

  private details(key: string): DetailsDto | null {
    const s = this.state;
    if (!s || key === '') return null;
    const full = this.full();
    const n = (this.tree && findNode(this.tree, key)) ?? (full && findNode(full, key));
    if (!n || n.key === 'root') return null;
    if (n.item) {
      const r = n.item;
      let specState: 'none' | 'ok' | 'missing' | 'outside' = 'none';
      if (r.item.spec !== '') {
        const p = resolveInRepo(r.repoPath, r.item.spec);
        specState = !p ? 'outside' : fs.existsSync(p) && fs.statSync(p).isFile() ? 'ok' : 'missing';
      }
      return itemDetails(s.workspace, r, key, specState);
    }
    // Counts and the by-status breakdown come from the unfiltered tree.
    return branchSummary((full && findNode(full, key)) ?? n, translateCoreLabel);
  }

  private postDetails(): void {
    if (!this.ready) return;
    const key = this.ui.selected[this.ui.view];
    this.send({ type: 'details', key, details: this.details(key) });
  }

  private send(msg: HostToWebview): void {
    if (this.panel && this.ready) void this.panel.webview.postMessage(msg);
  }

  private saveUi(): void {
    void this.context.workspaceState.update(UI_KEY, this.ui);
  }

  /** Stores open keys, dropping ones that are no longer branches (only once a scan has settled). */
  private setOpenKeys(keys: Iterable<string>): void {
    let open = [...keys];
    const full = this.state && !this.state.busy && this.state.workspace.snapshots.length > 0 ? this.full() : undefined;
    if (full) open = pruneOpenKeys(open, full);
    this.ui.open[this.ui.view] = open.slice(0, MAX_KEYS);
  }

  // ------------------------------------------------------------------------------------------ messages

  /** Messages from the webview are validated: the page is local, but its input is still input. */
  private async onMessage(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object' || this.disposed) return;
    const m = raw as WebviewToHost;
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.everReady = true;
        this.send({ type: 'init', strings: webviewStrings() });
        this.postState(true);
        this.postDetails();
        break;
      case 'setView':
        if (!isView(m.view) || m.view === this.ui.view) return;
        this.ui.view = m.view;
        this.saveUi();
        this.rebuild();
        this.postState(true);
        this.postDetails();
        break;
      case 'setFilter': {
        const f = filterFromDto(m.filter);
        this.ui.statuses = filterToDto(f).statuses;
        this.ui.sizes = [...f.sizes].slice(0, 50);
        this.search = f.search;
        this.saveUi();
        const hidden = [...f.hiddenRepos];
        const before = this.hiddenRepos();
        if (hidden.length !== before.length || hidden.some((k) => !before.includes(k))) {
          await this.context.globalState.update(HIDDEN_KEY, [...new Set(hidden)]);
        }
        this.rebuild();
        this.postState(false);
        break;
      }
      case 'preset': {
        if (!FILTER_PRESETS.includes(m.preset)) return;
        const f = applyPreset(m.preset as FilterPreset);
        this.ui.statuses = filterToDto(f).statuses;
        this.ui.sizes = [];
        this.saveUi();
        this.rebuild();
        this.postState(false);
        break;
      }
      case 'select':
        if (!isKey(m.key)) return;
        this.ui.selected[this.ui.view] = m.key;
        this.saveUi();
        this.postDetails();
        break;
      case 'toggle': {
        if (!isKey(m.key)) return;
        const open = new Set(this.ui.open[this.ui.view]);
        if (m.open === true) open.add(m.key);
        else open.delete(m.key);
        this.setOpenKeys(open);
        this.saveUi();
        break;
      }
      case 'layout':
        this.ui.attentionOpen = m.attentionOpen === true;
        this.ui.attentionHeight = num(m.attentionHeight, this.ui.attentionHeight, 40, 4000);
        this.ui.treeFraction = num(m.treeFraction, this.ui.treeFraction, 0.1, 0.9);
        this.saveUi();
        break;
      case 'openFile':
        if (isKey(m.repoKey) && isKey(m.path)) {
          await this.openFile(m.repoKey, m.path, clampLine(m.line));
        }
        break;
      case 'copy':
        if (!isStr(m.text)) return;
        await vscode.env.clipboard.writeText(m.text.slice(0, 1000));
        vscode.window.setStatusBarMessage(vscode.l10n.t('Copied {0}', m.text.slice(0, 12)), 2000);
        break;
      case 'jump':
        if (isKey(m.repo) && isKey(m.id)) this.jump(m.repo, m.id);
        break;
      case 'command':
        if (m.id === 'refresh') this.refresh();
        else if (m.id === 'trustTaskFiles') {
          // Only a key of a scanned repository; anything else runs the command without one.
          const known = isStr(m.repoKey) && (this.state?.workspace.snapshots ?? []).some((x) => x.repo.key === m.repoKey);
          await vscode.commands.executeCommand('speclog.trustTaskFiles', known ? m.repoKey : undefined);
        } else if (m.id === 'installHook') await vscode.commands.executeCommand('speclog.installHook');
        break;
    }
  }

  /** Selects an item (id) or, with id "", a repository node in the Program view, opening its ancestors. */
  private jump(repo: string, id: string): void {
    const s = this.state;
    if (!s) return;
    let key: string | undefined;
    if (id !== '') {
      const r = findItem(s.workspace, repo, id);
      if (!r) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: the item no longer exists.'));
        return;
      }
      const full = this.full();
      key = (this.tree && keyOfItem(this.tree, r)) ?? (full && keyOfItem(full, r));
    } else {
      if (this.ui.view !== 'program') {
        this.ui.view = 'program';
        this.rebuild();
      }
      const node = this.tree && findRepoNode(this.tree, repo, s.workspace.snapshots);
      if (!node) {
        void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: the repository is hidden by the filter.'));
        this.saveUi();
        this.postState(false);
        this.postDetails();
        return;
      }
      key = node.key;
    }
    if (!key) return;
    this.ui.selected[this.ui.view] = key;
    const path = this.tree ? pathToKey(this.tree, key) : [];
    const open = new Set(this.ui.open[this.ui.view]);
    for (const k of path.slice(0, -1)) open.add(k);
    this.setOpenKeys(open);
    this.saveUi();
    this.postState(true);
    this.postDetails();
  }

  /** Opens a file of a repository (given by path or key); only paths inside the repository. */
  private async openFile(repoKey: string, rel: string, line: number | undefined): Promise<void> {
    const snaps = this.state?.workspace.snapshots ?? [];
    const snap = snaps.find((x) => x.repo.path === repoKey) ?? snaps.find((x) => x.repo.key === repoKey);
    const full = snap ? resolveInRepo(snap.repo.path, rel) : undefined;
    if (!full) {
      void vscode.window.showWarningMessage(vscode.l10n.t('Speclog: {0} is outside the repository and was not opened.', rel));
      return;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(full));
      const options: vscode.TextDocumentShowOptions = { preview: true };
      if (line !== undefined && line > 0) {
        const pos = new vscode.Position(Math.min(line - 1, Math.max(0, doc.lineCount - 1)), 0);
        options.selection = new vscode.Range(pos, pos);
      }
      await vscode.window.showTextDocument(doc, options);
    } catch {
      void vscode.window.showWarningMessage(vscode.l10n.t('Speclog: {0} could not be opened.', rel));
    }
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const n = nonce();
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.css'));
    const csp = `default-src 'none'; script-src ${webview.cspSource} 'nonce-${n}'; style-src ${webview.cspSource};`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${style}">
<title>Speclog</title>
</head>
<body>
<div id="app"></div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }

  /** Stops the engine (waits for a running fetch, bounded by the engine). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.pendingTimer);
    this.pendingTimer = undefined;
    for (const d of this.subscriptions.splice(0)) d.dispose();
    this.panel?.dispose();
    const engine = this.engine;
    this.engine = undefined;
    if (engine) await engine.dispose();
  }
}
