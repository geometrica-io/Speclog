// The Speclog Report editor tab: a second webview panel with a period picker, a repository selection and the
// rendered report. The host computes (core computeReport, cancellable) and renders (renderReportBody); the
// webview only shows the HTML and sends intents (see reportProtocol.ts).
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { EngineState, PeriodPreset, ReportModel, computeReport, periodOf } from '@speclog/core';
import type { Period } from '@speclog/core';
import type { SpeclogHost } from './host';
import { defaultSaveDir, reportFileName } from './report/fileName';
import { renderReportMarkdown } from './report/renderMarkdown';
import { ReportGate, localDay, localStamp, repoChoices, repoPathsOf, repoSignature } from './report/panelPure';
import { REPORT_CSS, renderReportBody, renderReportDocument } from './report/renderHtml';
import { REPORT_PRESETS, parseReportMessage } from './reportProtocol';
import type { ReportFormat, ReportHostToWebview, ReportWebviewToHost } from './reportProtocol';
import { reportStrings, reportWebviewStrings } from './strings';

export class ReportPanel implements vscode.Disposable {
  private static current: ReportPanel | undefined;
  /** Repositories in the newest computed model; -1 before the first one (smoke-test hook). */
  private static lastRepos = -1;
  /** A report webview sent "ready" (its script ran under the CSP; smoke-test hook). */
  private static everReady = false;
  /** One disposer in context.subscriptions for every panel opened in this session. */
  private static disposerRegistered = false;

  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly gate = new ReportGate<EngineState['workspace']>();
  private ready = false;
  private preset: PeriodPreset = 'thisWeek';
  private from = '';
  private to = '';
  /** Selected repository keys; undefined until the first engine state (then the board's visible ones). */
  private selected: string[] | undefined;
  /** The repository list last sent in `controls` (keys and names). */
  private sentRepos: string | undefined;
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
    ReportPanel.current = new ReportPanel(panel, host, context, dist);
    if (!ReportPanel.disposerRegistered) {
      ReportPanel.disposerRegistered = true;
      // Deactivation aborts a running computation of whichever panel is open.
      context.subscriptions.push({ dispose: () => ReportPanel.current?.dispose() });
    }
  }

  /** Repositories in the newest computed model; -1 when none was computed yet. */
  static lastRepoCount(): number {
    return ReportPanel.lastRepos;
  }

  /** A report webview's script ran and sent "ready". */
  static webviewReady(): boolean {
    return ReportPanel.everReady;
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
      // No first scan will come (git missing, engine error): show why instead of waiting.
      host.onDidFail(() => { if (!this.host.currentState()) this.compute(); }),
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
    if (repoSignature(s.workspace.snapshots) !== this.sentRepos) this.postControls();
    this.postStaleIfNewer();
  }

  /** Starts a computation of the current period and selection; any running one is aborted. */
  private compute(): void {
    const state = this.host.currentState();
    const run = this.gate.begin(state?.workspace);
    if (!state) {
      // onState computes once the first scan has finished; until then the reason it cannot, if any.
      const why = this.host.unavailableReason();
      if (why) this.postView({ type: 'error', text: why });
      else this.postBusy(0, 0);
      return;
    }
    this.postBusy(0, 0);
    if (this.selected === undefined) this.selected = this.host.visibleRepoKeys();
    const ws = state.workspace;
    const today = localDay(new Date());
    // Recomputed here, so a preset ending today follows the date.
    const period = this.setPeriod(this.preset, this.from, this.to, today);
    this.postControls();
    void computeReport({
      snapshots: ws.snapshots, live: ws, today, period, mode: this.host.engineMode(),
      selectedRepoPaths: repoPathsOf(ws.snapshots, this.selected), signal: run.signal,
      onProgress: (done, total) => { if (run.isCurrent()) this.postBusy(done, total); },
    }).then((r) => {
      if (this.disposed) return;
      const next = this.gate.settle(run, r.model, r.error);
      if (next === 'show' && r.model) this.show(r.model);
      else if (next === 'error') this.postError(r.error);
    }, (e: unknown) => {
      if (this.disposed) return;
      const why = e instanceof Error ? e.message : String(e);
      if (this.gate.settle(run, null, why) === 'error') this.postError(why);
    });
  }

  private show(model: ReportModel): void {
    this.model = model;
    ReportPanel.lastRepos = model.repos.length;
    const html = renderReportBody(model, reportStrings(), this.meta());
    this.postView({ type: 'report', html });
    this.postStaleIfNewer();
  }

  private meta(): { generated: string; version: string } {
    const version = String((this.context.extension.packageJSON as { version?: unknown }).version ?? '');
    return { generated: localStamp(new Date()), version };
  }

  /** Exports the newest model (a stale one as is); the buttons are disabled until one exists. */
  private async export(format: ReportFormat): Promise<void> {
    const model = this.model;
    if (!model) return;
    const strings = reportStrings();
    const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
    if (format === 'pdf') {
      // Opened in the browser, where it is printed or saved as PDF; every list printed open.
      const html = renderReportDocument(model, strings, this.meta(), { expandAll: true });
      // Left for the browser to read; the OS temp cleanup removes it.
      const name = reportFileName(model.period, 'html', crypto.randomBytes(6).toString('hex'));
      const file = vscode.Uri.file(path.join(os.tmpdir(), name));
      await vscode.workspace.fs.writeFile(file, bytes(html));
      if (!(await vscode.env.openExternal(file))) {
        void vscode.window.showErrorMessage(vscode.l10n.t('The browser did not open the report. Open this file by hand: {0}', file.fsPath));
        return;
      }
      void vscode.window.showInformationMessage(vscode.l10n.t('The report opened in your browser. Print it or save it as PDF there.'));
      return;
    }
    const content = format === 'html' ? renderReportDocument(model, strings, this.meta()) : renderReportMarkdown(model, strings, this.meta());
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const def = reportFileName(model.period, format);
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(defaultSaveDir(folder?.fsPath, os.homedir()), def)),
      filters: format === 'html' ? { HTML: ['html'] } : { Markdown: ['md'] },
    });
    if (!target) return;
    await vscode.workspace.fs.writeFile(target, bytes(content));
    const open = vscode.l10n.t('Open');
    const choice = await vscode.window.showInformationMessage(vscode.l10n.t('Report saved to {0}.', target.fsPath), open);
    if (choice !== open) return;
    if (format === 'md') await vscode.window.showTextDocument(target);
    else if (!(await vscode.env.openExternal(target))) {
      void vscode.window.showErrorMessage(vscode.l10n.t('The browser did not open the report. Open this file by hand: {0}', target.fsPath));
    }
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
    if (this.gate.isStale(this.host.currentState()?.workspace)) this.send({ type: 'stale' });
  }

  private postControls(): void {
    const snapshots = this.host.currentState()?.workspace.snapshots ?? [];
    this.sentRepos = repoSignature(snapshots);
    this.send({ type: 'controls', preset: this.preset, from: this.from, to: this.to, repos: repoChoices(snapshots, this.selected ?? []) });
  }

  private onMessage(raw: unknown): void {
    if (this.disposed) return;
    const m: ReportWebviewToHost | null = parseReportMessage(raw);
    if (!m) return;
    switch (m.type) {
      case 'ready':
        this.ready = true;
        ReportPanel.everReady = true;
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
        // Without a scan yet (git was missing), Refresh also retries starting the engine.
        if (!this.host.currentState()) this.host.refresh();
        this.compute();
        break;
      case 'export':
        this.export(m.format).catch((e: unknown) => {
          void vscode.window.showErrorMessage(vscode.l10n.t('Speclog: the report could not be exported: {0}', e instanceof Error ? e.message : String(e)));
        });
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
    this.gate.cancel();
    if (ReportPanel.current === this) ReportPanel.current = undefined;
    for (const d of this.subscriptions.splice(0)) d.dispose();
    this.panel.dispose();
  }
}
