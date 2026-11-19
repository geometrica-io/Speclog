// The Speclog Report editor tab: a second webview panel with a period picker, a repository selection and the
// rendered report. The host computes (core computeReport, cancellable) and renders (renderReportBody); the
// webview only shows the HTML and sends intents (see reportProtocol.ts).
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { EngineState, PeriodPreset, ReportModel, computeReport, periodOf } from '@speclog/core';
import type { Period } from '@speclog/core';
import type { SpeclogHost } from './host';
import { LatestRun } from './report/latestRun';
import { localDay, localStamp, repoChoices, repoPathsOf } from './report/panelPure';
import { REPORT_CSS, renderReportBody } from './report/renderHtml';
import { REPORT_PRESETS, parseReportMessage } from './reportProtocol';
import type { ReportHostToWebview, ReportWebviewToHost } from './reportProtocol';
import { reportStrings, reportWebviewStrings } from './strings';

export class ReportPanel implements vscode.Disposable {
  private static current: ReportPanel | undefined;
  /** Repositories in the newest computed model; -1 before the first one (smoke-test hook). */
  private static lastRepos = -1;

  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly run = new LatestRun();
  private ready = false;
  private preset: PeriodPreset = 'thisWeek';
  private from = '';
  private to = '';
  /** Selected repository keys; undefined until the first engine state (then the board's visible ones). */
  private selected: string[] | undefined;
  /** The workspace the shown (or running) report was computed from. */
  private computedFrom: EngineState['workspace'] | undefined;
  private model: ReportModel | undefined;
  /** What the webview shows below the controls (progress, report or error): resent when it is shown again. */
  private lastView: ReportHostToWebview | undefined;
  private disposed = false;

  /** Opens the report tab, or brings it to the front. */
  static show(host: SpeclogHost, context: vscode.ExtensionContext): void {
    if (ReportPanel.current) {
      ReportPanel.current.panel.reveal();
      return;
    }
    const dist = vscode.Uri.joinPath(context.extensionUri, 'dist');
    const panel = vscode.window.createWebviewPanel('speclog.report', vscode.l10n.t('Speclog Report'), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [dist],
    });
    panel.iconPath = vscode.Uri.joinPath(context.extensionUri, 'assets', 'speclog.svg');
    const p = new ReportPanel(panel, host, context, dist);
    ReportPanel.current = p;
    // Deactivation aborts a running computation (dispose is idempotent).
    context.subscriptions.push(p);
  }

  /** Repositories in the newest computed model; -1 when none was computed yet. */
  static lastRepoCount(): number {
    return ReportPanel.lastRepos;
  }

  /** The newest computed model, for export. */
  get lastModel(): ReportModel | undefined {
    return this.model;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly host: SpeclogHost,
    private readonly context: vscode.ExtensionContext,
    dist: vscode.Uri,
  ) {
    this.subscriptions.push(
      panel.onDidDispose(() => this.dispose()),
      panel.webview.onDidReceiveMessage((m: unknown) => this.onMessage(m)),
      // A hidden webview is discarded; it sends "ready" again when shown.
      panel.onDidChangeViewState((e) => { if (!e.webviewPanel.visible) this.ready = false; }),
      host.onDidChangeState((s) => this.onState(s)),
    );
    panel.webview.html = this.html(panel.webview, dist);
    this.setPeriod('thisWeek', '', '');
    this.compute();
  }

  private setPeriod(preset: PeriodPreset, from: string, to: string, today = localDay(new Date())): Period {
    const p = periodOf(preset, today, from, to);
    this.preset = p.preset;
    this.from = p.from;
    this.to = p.to;
    return p;
  }

  private onState(s: EngineState): void {
    if (this.disposed) return;
    if (this.selected === undefined) {
      // The first state: the report waited for it.
      this.compute();
      return;
    }
    this.postControls();
    this.postStaleIfNewer();
  }

  /** Starts a computation of the current period and selection; any running one is aborted. */
  private compute(): void {
    const state = this.host.currentState();
    const run = this.run.begin();
    this.postBusy(0, 0);
    if (!state) return; // onState computes once the first scan has finished.
    if (this.selected === undefined) this.selected = this.host.visibleRepoKeys();
    const ws = state.workspace;
    this.computedFrom = ws;
    const today = localDay(new Date());
    // Recomputed here, so a preset ending today follows the date.
    const period = this.setPeriod(this.preset, this.from, this.to, today);
    this.postControls();
    void computeReport({
      snapshots: ws.snapshots, live: ws, today, period, mode: this.host.engineMode(),
      selectedRepoPaths: repoPathsOf(ws.snapshots, this.selected), signal: run.signal,
      onProgress: (done, total) => { if (run.isCurrent()) this.postBusy(done, total); },
    }).then((r) => {
      if (!run.isCurrent() || this.disposed) return;
      if (!r.model) {
        if (r.error !== 'cancelled') this.postError(r.error);
        return;
      }
      this.show(r.model);
    }, (e: unknown) => {
      if (!run.isCurrent() || this.disposed) return;
      this.postError(e instanceof Error ? e.message : String(e));
    });
  }

  private show(model: ReportModel): void {
    this.model = model;
    ReportPanel.lastRepos = model.repos.length;
    const version = String((this.context.extension.packageJSON as { version?: unknown }).version ?? '');
    const html = renderReportBody(model, reportStrings(), { generated: localStamp(new Date()), version });
    this.postView({ type: 'report', html });
    this.postStaleIfNewer();
  }

  private postBusy(done: number, total: number): void {
    this.postView({ type: 'busy', done, total });
  }

  private postError(why: string): void {
    this.postView({ type: 'error', text: vscode.l10n.t('Speclog: the report could not be computed: {0}', why) });
  }

  private postView(msg: ReportHostToWebview): void {
    this.lastView = msg;
    this.send(msg);
  }

  /** A shown report from an older workspace than the engine's newest offers a Refresh. */
  private postStaleIfNewer(): void {
    const s = this.host.currentState();
    if (this.lastView?.type === 'report' && s && s.workspace !== this.computedFrom) this.send({ type: 'stale' });
  }

  private postControls(): void {
    const snapshots = this.host.currentState()?.workspace.snapshots ?? [];
    this.send({ type: 'controls', preset: this.preset, from: this.from, to: this.to, repos: repoChoices(snapshots, this.selected ?? []) });
  }

  private onMessage(raw: unknown): void {
    if (this.disposed) return;
    const m: ReportWebviewToHost | null = parseReportMessage(raw);
    if (!m) return;
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.send({ type: 'init', strings: reportWebviewStrings(), presets: [...REPORT_PRESETS] });
        this.postControls();
        // A re-shown webview gets what it had: the progress, the report or the error.
        if (this.lastView) this.send(this.lastView);
        this.postStaleIfNewer();
        break;
      case 'period':
        this.setPeriod(m.preset as PeriodPreset, m.from, m.to);
        this.compute();
        break;
      case 'repos': {
        // Only keys of scanned repositories are kept; before the first scan there are none to choose.
        const state = this.host.currentState();
        if (!state) return;
        const known = new Set(state.workspace.snapshots.map((s) => s.repo.key));
        this.selected = [...new Set(m.keys)].filter((k) => known.has(k));
        this.compute();
        break;
      }
      case 'refresh':
        this.compute();
        break;
      case 'export':
        // Export of lastModel comes with the export task (REP.4).
        break;
    }
  }

  private send(msg: ReportHostToWebview): void {
    if (this.ready && !this.disposed) void this.panel.webview.postMessage(msg);
  }

  private html(webview: vscode.Webview, dist: vscode.Uri): string {
    const n = crypto.randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'report.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'report.css'));
    // REPORT_CSS (the export's stylesheet) is inlined under the nonce; report.css maps its colours to the theme.
    const csp = `default-src 'none'; script-src ${webview.cspSource} 'nonce-${n}'; style-src ${webview.cspSource} 'nonce-${n}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${n}">${REPORT_CSS}</style>
<link rel="stylesheet" href="${style}">
<title>Speclog Report</title>
</head>
<body>
<div id="app"></div>
<script nonce="${n}" src="${script}"></script>
</body>
</html>`;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.run.cancel();
    if (ReportPanel.current === this) ReportPanel.current = undefined;
    for (const d of this.subscriptions.splice(0)) d.dispose();
    this.panel.dispose();
  }
}
