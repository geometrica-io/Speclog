// Where and how an agent prompt is delivered. Pure: no `vscode` import, so it is unit-testable.
import * as path from 'path';

export type AgentTarget = 'auto' | 'chat' | 'terminal' | 'clipboard';
export type Delivery = 'chat' | 'terminal' | 'clipboard' | 'clipboardOpenWindow';

export const PROMPT_FILE_ARG = (file: string) => `Read the task in ${file} and follow it.`;

const MAX_INLINE_PROMPT = 4000;
const STALE_MS = 7 * 86_400_000;

export function resolveDelivery(setting: AgentTarget, chatAvailable: boolean, repoInWorkspace: boolean): Delivery {
  if (setting === 'terminal') return 'terminal';
  if (setting === 'clipboard') return 'clipboard';
  // 'chat' and 'auto' both prefer chat; fall back to the clipboard by the same repo rule.
  if (chatAvailable && repoInWorkspace) return 'chat';
  return repoInWorkspace ? 'clipboard' : 'clipboardOpenWindow';
}

function pathApi(platform: NodeJS.Platform): typeof path.posix {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function isInsideWorkspace(repoPath: string, folders: string[], platform: NodeJS.Platform): boolean {
  const p = pathApi(platform);
  const norm = (s: string): string => {
    let n = p.normalize(s);
    while (n.length > 1 && (n.endsWith(p.sep) || n.endsWith('/'))) n = n.slice(0, -1);
    return platform === 'win32' ? n.toLowerCase() : n;
  };
  const repo = norm(repoPath);
  return folders.some((f) => {
    const folder = norm(f);
    if (repo === folder) return true;
    const prefix = folder.endsWith(p.sep) ? folder : folder + p.sep;
    return repo.startsWith(prefix);
  });
}

/** True when cmd names a file by a relative path (has a separator, or a drive without a root on win32). */
function isRelativePath(cmd: string, platform: NodeJS.Platform): boolean {
  const p = pathApi(platform);
  const pathLike = cmd.includes('/') || cmd.includes(p.sep) || (platform === 'win32' && cmd.includes(':'));
  return pathLike && !p.isAbsolute(cmd);
}

export type TerminalCommandProblem = 'notList' | 'empty' | 'noExecutable' | 'relativePath';

export type TerminalCommandCheck =
  | { ok: true; command: string[] }
  | { ok: false; problem: TerminalCommandProblem; value: string };

/**
 * Validates speclog.agent.terminalCommand: a list of strings whose first entry is a bare name (looked up
 * on PATH) or an absolute path. Relative paths are refused, never resolved against a repository.
 * Arguments are kept as written (an empty or spaced argument is valid).
 */
export function checkTerminalCommand(v: unknown, platform: NodeJS.Platform): TerminalCommandCheck {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) return { ok: false, problem: 'notList', value: '' };
  const args = v as string[];
  if (args.length === 0) return { ok: false, problem: 'empty', value: '' };
  const exe = args[0].trim();
  if (exe === '') return { ok: false, problem: 'noExecutable', value: '' };
  if (isRelativePath(exe, platform)) return { ok: false, problem: 'relativePath', value: exe };
  return { ok: true, command: [exe, ...args.slice(1)] };
}

/** An absolute path for cmd (a bare name looked up on the absolute PATH entries, or an absolute path), else undefined. */
export function resolveExecutable(
  cmd: string,
  envPath: string,
  pathExt: string,
  platform: NodeJS.Platform,
  exists: (p: string) => boolean,
): string | undefined {
  if (!cmd) return undefined;
  const p = pathApi(platform);
  const win = platform === 'win32';
  const exts = win
    ? (pathExt || '.COM;.EXE;.BAT;.CMD')
        .split(';')
        .filter(Boolean)
        .map((e) => e.toLowerCase())
    : [];
  // On win32 the bare name counts only when it already carries a PATHEXT extension; otherwise the
  // PATHEXT launchers win over extensionless shims (npm writes a `claude` sh-shim next to claude.cmd).
  const hasExt = win && exts.includes(p.extname(cmd).toLowerCase());
  const variants = (base: string): string[] => (!win || hasExt ? [base] : exts.map((e) => base + e));

  if (p.isAbsolute(cmd)) return variants(cmd).find(exists);
  if (isRelativePath(cmd, platform)) return undefined;
  // Relative PATH entries (".", "node_modules\.bin") are skipped: they would depend on the working folder.
  const dirs = envPath
    .split(win ? ';' : ':')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => d !== '' && p.isAbsolute(d));
  for (const dir of dirs) {
    const found = variants(p.join(dir, cmd)).find(exists);
    if (found) return found;
  }
  return undefined;
}

export function needsPromptFile(executable: string, prompt: string): boolean {
  return /\.(cmd|bat)$/i.test(executable) || prompt.length > MAX_INLINE_PROMPT;
}

const MAX_FILE_NAME = 120;

export function promptFileName(repo: string, id: string, now: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${z(now.getMonth() + 1)}${z(now.getDate())}-` +
    `${z(now.getHours())}${z(now.getMinutes())}${z(now.getSeconds())}`;
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
  const suffix = `-${stamp}.md`;
  const r = safe(repo).slice(0, 30);
  const i = safe(id).slice(0, Math.max(0, MAX_FILE_NAME - suffix.length - r.length - 1));
  return `${r}-${i}${suffix}`;
}

export function staleFiles(files: { name: string; mtimeMs: number }[], nowMs: number): string[] {
  return files.filter((f) => nowMs - f.mtimeMs > STALE_MS).map((f) => f.name);
}
