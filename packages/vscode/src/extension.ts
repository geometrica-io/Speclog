// Extension entry point: hosts the engine, registers commands and the activity-bar view.
import * as vscode from 'vscode';
import { cleanPromptFiles } from './agent';
import { registerCommands } from './commands';
import { SpeclogHost } from './host';
import { ReportPanel } from './reportPanel';

/** VS Code gives deactivate about 5 s; stop waiting for the engine before that. */
const DEACTIVATE_WAIT_MS = 4000;

/** Returned from activate; used by the smoke test. */
export interface SpeclogApi {
  getStatusText(): string;
  isPanelOpen(): boolean;
  lastPosted(): unknown;
  /** The webview script ran and sent "ready". */
  webviewReady(): boolean;
  /** repoKey -> trusted commit (globalState). */
  trustCommits(): Record<string, string>;
  /** The newest details message built for the webview. */
  lastDetails(): unknown;
  /** Handles a message as if the webview had sent it. */
  receive(m: unknown): Promise<void>;
  /** Repositories in the report tab's newest computed model; -1 when none was computed yet. */
  lastReportRepoCount(): number;
}

let host: SpeclogHost | undefined;

const emptyTree: vscode.TreeDataProvider<never> = {
  getTreeItem: (e: never) => e,
  getChildren: () => [],
};

export function activate(context: vscode.ExtensionContext): SpeclogApi {
  const h = new SpeclogHost(context);
  host = h;
  context.subscriptions.push(...registerCommands(context, h));
  void cleanPromptFiles(context);

  // The activity-bar view only shows a welcome text with an Open button; showing it opens the panel.
  const view = vscode.window.createTreeView('speclog.home', { treeDataProvider: emptyTree });
  context.subscriptions.push(view, view.onDidChangeVisibility((e) => {
    if (e.visible) h.open();
  }));

  void h.start();
  return {
    getStatusText: () => h.statusText,
    isPanelOpen: () => h.panelOpen,
    lastPosted: () => h.lastPosted,
    webviewReady: () => h.webviewReady,
    trustCommits: () => h.trustCommits(),
    lastDetails: () => h.lastDetails,
    receive: (m) => h.receive(m),
    lastReportRepoCount: () => ReportPanel.lastRepoCount(),
  };
}

export async function deactivate(): Promise<void> {
  const h = host;
  host = undefined;
  if (!h) return;
  let limit: NodeJS.Timeout | undefined;
  await Promise.race([
    h.dispose(),
    new Promise<void>((resolve) => { limit = setTimeout(resolve, DEACTIVATE_WAIT_MS); }),
  ]);
  clearTimeout(limit);
}
