// The status bar item: `$(checklist) Speclog: <done>/<total> · ⚠ <n> · ? <n>`; a click opens the panel.
import * as vscode from 'vscode';
import { Summary } from './summary';

/** `Speclog: <done>/<total>` + ` · ⚠ <n>` when Attention has rows + ` · ? <n>` when items are unverified. */
export function statusLabel(sum: Summary): string {
  let t = vscode.l10n.t('Speclog: {0}/{1}', sum.done, sum.total);
  if (sum.attention > 0) t += ` · ⚠ ${sum.attention}`;
  if (sum.unverified > 0) t += ` · ? ${sum.unverified}`;
  return t;
}

export class SpeclogStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem('speclog.status', vscode.StatusBarAlignment.Left, 0);
    this.item.name = 'Speclog';
    this.item.command = 'speclog.open';
    this.item.tooltip = vscode.l10n.t('Open Speclog');
    this.item.text = `$(sync~spin) ${vscode.l10n.t('Speclog: scanning')}`;
    this.item.show();
  }

  /** The current text, for the smoke test. */
  get text(): string {
    return this.item.text;
  }

  update(sum: Summary): void {
    this.item.text = `$(checklist) ${statusLabel(sum)}`;
    this.item.tooltip = vscode.l10n.t('Speclog: {0} done of {1} in {2} repositories. Click to open.', sum.done, sum.total, sum.repos);
    this.item.backgroundColor = undefined;
  }

  gitMissing(): void {
    this.item.text = `$(error) ${vscode.l10n.t('Speclog: git not found')}`;
    this.item.tooltip = vscode.l10n.t('Speclog needs git 2.31 or newer on the PATH.');
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  dispose(): void {
    this.item.dispose();
  }
}
