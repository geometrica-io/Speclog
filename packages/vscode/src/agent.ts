// Send to agent: hands one item's prompt to VS Code chat, a terminal running the user's agent command,
// or the clipboard. Speclog writes nothing into a repository and keeps no record of what was sent; the
// only writes are the terminal, the clipboard and prompt files in the extension's own storage.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  AgentPrompt, ResolvedItem, Workspace, agentAvailability, applyPreset, buildAgentPrompt, buildTree,
} from '@speclog/core';
import {
  PROMPT_FILE_ARG, TerminalCommandCheck, isAbsoluteCommand, isInsideWorkspace, needsPromptFile, promptFileName, resolveDelivery, resolveExecutable, staleFiles,
} from './agentPure';
import { findNode } from './dto';
import { readAgentConfig } from './settings';
import { agentBlockText, agentGuardText } from './strings';

export type SendResult = 'sent' | 'cancelled' | 'refused';

const CHAT_COMMAND = 'workbench.action.chat.open';

/** The item behind a tree key, looked up in the current workspace (keys are opaque, never parsed). */
function resolveKey(w: Workspace, key: string): ResolvedItem | undefined {
  // Item keys do not depend on the view, and the unfiltered tree holds every item.
  return findNode(buildTree(w, 'program', applyPreset('all')), key)?.item;
}

/** The item, or undefined after telling the user why it cannot be used. */
function usableItem(w: Workspace, key: string): ResolvedItem | undefined {
  const r = resolveKey(w, key);
  if (!r) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: the item no longer exists.'));
    return undefined;
  }
  const { block } = agentAvailability(w, r);
  if (block) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Speclog: {0} cannot be sent to an agent: {1}', r.item.id, agentBlockText(block)));
    return undefined;
  }
  return r;
}

/** Warns about unknown template placeholders; called only once the prompt is really used. */
function warnUnknownPlaceholders(p: AgentPrompt): void {
  if (p.unknownPlaceholders.length === 0) return;
  void vscode.window.showWarningMessage(vscode.l10n.t(
    'Speclog: the prompt template has unknown placeholders, left as written: {0}',
    p.unknownPlaceholders.map((n) => `{${n}}`).join(', ')));
}

const TERMINAL_COMMAND_SETTING = 'speclog.agent.terminalCommand';

/** Why the terminalCommand setting cannot be used, naming the setting. */
function terminalCommandProblem(c: Extract<TerminalCommandCheck, { ok: false }>): string {
  switch (c.problem) {
    case 'notList': return vscode.l10n.t(
      'Speclog: {0} must be a list of strings, the executable first; nothing was sent.', TERMINAL_COMMAND_SETTING);
    case 'empty': return vscode.l10n.t(
      'Speclog: {0} is empty; set the executable as its first entry. Nothing was sent.', TERMINAL_COMMAND_SETTING);
    case 'noExecutable': return vscode.l10n.t(
      'Speclog: the first entry of {0} (the executable) is empty; nothing was sent.', TERMINAL_COMMAND_SETTING);
    case 'relativePath': return vscode.l10n.t(
      'Speclog: the executable in {0} must be a name found on PATH or an absolute path, not the relative path "{1}"; nothing was sent.',
      TERMINAL_COMMAND_SETTING, c.value);
  }
}

function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function promptDir(ctx: vscode.ExtensionContext): string {
  return vscode.Uri.joinPath(ctx.globalStorageUri, 'prompts').fsPath;
}

/** Pre-fills VS Code chat and also copies the prompt, in case no agent answers in that chat. */
async function toChat(r: ResolvedItem, text: string): Promise<void> {
  try {
    await vscode.commands.executeCommand(CHAT_COMMAND, { query: text, isPartialQuery: true });
  } catch {
    await copied(r, text, false);
    return;
  }
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage(vscode.l10n.t(
    'Prompt for {0} is in the chat input, not sent; it is also copied to the clipboard.', r.item.id));
}

async function copied(r: ResolvedItem, text: string, openWindow: boolean): Promise<void> {
  await vscode.env.clipboard.writeText(text);
  if (!openWindow) {
    void vscode.window.showInformationMessage(vscode.l10n.t('Prompt for {0} copied — paste it into your agent.', r.item.id));
    return;
  }
  const open = vscode.l10n.t('Open repository in new window');
  void vscode.window.showInformationMessage(
    vscode.l10n.t('Prompt for {0} copied — {1} is not open in this window; paste it into your agent there.', r.item.id, r.repo),
    open,
  ).then((pick) => {
    if (pick === open) {
      void vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(r.repoPath), { forceNewWindow: true });
    }
  });
}

async function toTerminal(ctx: vscode.ExtensionContext, r: ResolvedItem, text: string, command: string[]): Promise<SendResult> {
  const [cmd, ...fixedArgs] = command;
  const exe = resolveExecutable(cmd, process.env.PATH ?? '', process.env.PATHEXT ?? '', process.platform, isFile);
  if (!exe) {
    void vscode.window.showErrorMessage(isAbsoluteCommand(cmd, process.platform)
      ? vscode.l10n.t('Agent command "{0}" does not exist.', cmd)
      : vscode.l10n.t('Agent command "{0}" was not found on PATH.', cmd));
    return 'refused';
  }
  let arg = text;
  if (needsPromptFile(exe, text)) {
    // A batch launcher would mangle the prompt in cmd.exe; a long one may not fit a command line.
    const dir = promptDir(ctx);
    const file = path.join(dir, promptFileName(r.repo, r.item.id, new Date()));
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(file, text, 'utf8');
    } catch (e) {
      void vscode.window.showErrorMessage(vscode.l10n.t('Speclog: the prompt file could not be written: {0}',
        e instanceof Error ? e.message : String(e)));
      return 'refused';
    }
    arg = PROMPT_FILE_ARG(file);
  }
  // shellPath + shellArgs: no shell string, so no shell's quoting rules apply to the prompt.
  const terminal = vscode.window.createTerminal({
    name: vscode.l10n.t('Speclog: {0}', r.item.id), cwd: r.repoPath, shellPath: exe, shellArgs: [...fixedArgs, arg],
  });
  terminal.show();
  return 'sent';
}

/** Sends the item with this tree key to the configured target, after confirming its guards. */
export async function sendToAgent(ctx: vscode.ExtensionContext, w: Workspace, key: string): Promise<SendResult> {
  const r = usableItem(w, key);
  if (!r) return 'refused';
  const config = readAgentConfig();
  const { guards } = agentAvailability(w, r);
  const prompt = buildAgentPrompt(w, r, config.promptTemplate);
  const chatAvailable = (await vscode.commands.getCommands(true)).includes(CHAT_COMMAND);
  const inWorkspace = isInsideWorkspace(r.repoPath, workspaceFolders(), process.platform);
  const delivery = resolveDelivery(config.target, chatAvailable, inWorkspace);
  // A broken terminalCommand is reported before any confirmation, and never replaced by a default.
  if (delivery === 'terminal' && !config.terminalCommand.ok) {
    void vscode.window.showWarningMessage(terminalCommandProblem(config.terminalCommand));
    return 'refused';
  }
  if (guards.length > 0) {
    const lines = guards.map(agentGuardText);
    if (prompt.guardsOmitted) {
      lines.push(vscode.l10n.t('The prompt template has no {0} placeholder, so the agent will not receive the stop-and-ask line.', '{guards}'));
    }
    const go = vscode.l10n.t('Continue');
    const pick = await vscode.window.showWarningMessage(vscode.l10n.t('Send {0} to an agent?', r.item.id),
      { modal: true, detail: lines.join('\n') }, go);
    if (pick !== go) return 'cancelled';
  }
  // Unknown placeholders are reported only once the user goes ahead.
  warnUnknownPlaceholders(prompt);
  const { text } = prompt;
  switch (delivery) {
    case 'chat':
      await toChat(r, text);
      return 'sent';
    case 'terminal':
      return toTerminal(ctx, r, text, config.terminalCommand.ok ? config.terminalCommand.command : []);
    case 'clipboard':
      await copied(r, text, false);
      return 'sent';
    case 'clipboardOpenWindow':
      await copied(r, text, true);
      return 'sent';
  }
}

/** Copies the item's prompt, whatever the target (no confirmation: nothing is sent). */
export async function copyAgentPrompt(w: Workspace, key: string): Promise<void> {
  const r = usableItem(w, key);
  if (!r) return;
  const prompt = buildAgentPrompt(w, r, readAgentConfig().promptTemplate);
  warnUnknownPlaceholders(prompt);
  await copied(r, prompt.text, false);
}

/** Deletes prompt files older than 7 days (on activation); failures are ignored. */
export async function cleanPromptFiles(ctx: vscode.ExtensionContext): Promise<void> {
  const dir = promptDir(ctx);
  let names: string[];
  try {
    names = await fs.promises.readdir(dir);
  } catch {
    return;
  }
  const files: { name: string; mtimeMs: number }[] = [];
  for (const name of names) {
    try {
      const st = await fs.promises.stat(path.join(dir, name));
      if (st.isFile()) files.push({ name, mtimeMs: st.mtimeMs });
    } catch { /* gone meanwhile */ }
  }
  for (const name of staleFiles(files, Date.now())) {
    try {
      await fs.promises.unlink(path.join(dir, name));
    } catch { /* best effort */ }
  }
}
