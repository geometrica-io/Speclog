// Command registrations. The hook and trust commands are wired here; their behavior lands with
// the hook installer and the trust picker.
import * as vscode from 'vscode';
import type { SpeclogHost } from './host';

export function registerCommands(host: SpeclogHost): vscode.Disposable[] {
  const notYet = (): void => {
    void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: this command is not available yet.'));
  };
  return [
    vscode.commands.registerCommand('speclog.open', () => host.open()),
    vscode.commands.registerCommand('speclog.refresh', () => host.refresh()),
    vscode.commands.registerCommand('speclog.installHook', notYet),
    vscode.commands.registerCommand('speclog.trustTaskFiles', notYet),
    vscode.commands.registerCommand('speclog.untrustTaskFiles', notYet),
  ];
}
