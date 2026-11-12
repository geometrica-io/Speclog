// Extension entry point: hosts the engine, registers commands and the activity-bar view.
import * as vscode from 'vscode';
import { registerCommands } from './commands';
import { SpeclogHost } from './host';

/** VS Code gives deactivate about 5 s; stop waiting for the engine before that. */
const DEACTIVATE_WAIT_MS = 4000;

/** Returned from activate; used by the smoke test. */
export interface SpeclogApi {
  getStatusText(): string;
  isPanelOpen(): boolean;
  lastPosted(): unknown;
}

let host: SpeclogHost | undefined;

const emptyTree: vscode.TreeDataProvider<never> = {
  getTreeItem: (e: never) => e,
  getChildren: () => [],
};

export function activate(context: vscode.ExtensionContext): SpeclogApi {
  const h = new SpeclogHost(context);
  host = h;
  context.subscriptions.push(...registerCommands(h));

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
