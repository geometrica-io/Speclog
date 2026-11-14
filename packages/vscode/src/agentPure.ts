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
  const exts = win ? pathExt.split(';').filter(Boolean).map((e) => e.toLowerCase()) : [];
  const hasExt = win && p.extname(cmd) !== '';
  const variants = (base: string): string[] => (win && !hasExt ? [base, ...exts.map((e) => base + e)] : [base]);

  if (cmd.includes('/') || cmd.includes(p.sep)) {
    return variants(cmd).find(exists);
  }
  for (const dir of envPath.split(win ? ';' : ':').filter(Boolean)) {
    const found = variants(p.join(dir, cmd)).find(exists);
    if (found) return found;
  }
  return undefined;
}

export function needsPromptFile(executable: string, prompt: string): boolean {
  return /\.(cmd|bat)$/i.test(executable) || prompt.length > MAX_INLINE_PROMPT;
}

export function promptFileName(repo: string, id: string, now: Date): string {
  const z = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${z(now.getMonth() + 1)}${z(now.getDate())}-` +
    `${z(now.getHours())}${z(now.getMinutes())}${z(now.getSeconds())}`;
  const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
  return `${safe(repo)}-${safe(id)}-${stamp}.md`;
}

export function staleFiles(files: { name: string; mtimeMs: number }[], nowMs: number): string[] {
  return files.filter((f) => nowMs - f.mtimeMs > STALE_MS).map((f) => f.name);
}
