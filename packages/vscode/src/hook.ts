// Installs the Speclog commit-msg hook into a repository. Pure Node (no vscode import) so it is
// unit-testable; the command layer shows the messages.
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Thrown by installHook; the command maps the code to a translated message. */
export class HookError extends Error {
  constructor(public readonly code: 'bothHooksExist' | 'notARepo', message: string) { super(message); }
}

export type InstallResult = 'installed' | 'already' | 'skipped-hooksPath' | 'chained';

/** The hook's own marker line: how the installer recognises a hook it wrote. */
const MARKER = 'Speclog commit-msg hook marker';

/** The shipped hook script: dist/extension.js and src/hook.ts both sit next to assets/. */
export function hookSourcePath(): string {
  return path.join(__dirname, '..', 'assets', 'hook', 'commit-msg');
}

function git(repoPath: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd: repoPath, windowsHide: true, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1) : 0;
        resolve({ code, out: String(stdout).trim() });
      });
  });
}

/** The repository's core.hooksPath ("" when unset). */
export async function hooksPathOf(repoPath: string): Promise<string> {
  const r = await git(repoPath, ['config', '--get', 'core.hooksPath']);
  return r.code === 0 ? r.out : '';
}

/** The file operations installHook uses (a test seam; default: Node's fs). */
export type HookFs = Pick<typeof fs, 'readFileSync' | 'writeFileSync' | 'existsSync' | 'mkdirSync' | 'renameSync' |
  'chmodSync' | 'rmSync'>;

/**
 * Installs the hook as <git hooks dir>/commit-msg. A foreign hook is kept as commit-msg.local (the
 * hook runs it first); a 0-byte one is replaced; core.hooksPath set means nothing is touched. The
 * new hook is written to a temporary file first and renamed into place; if that fails, a foreign
 * hook is moved back, so it is never left only as commit-msg.local.
 */
export async function installHook(repoPath: string, io: HookFs = fs): Promise<InstallResult> {
  if (await hooksPathOf(repoPath)) return 'skipped-hooksPath';
  const hp = await git(repoPath, ['rev-parse', '--git-path', 'hooks']);
  if (hp.code !== 0 || !hp.out) throw new HookError('notARepo', `not a git repository: ${repoPath}`);
  const hooks = path.resolve(repoPath, hp.out);
  const target = path.join(hooks, 'commit-msg');
  const local = path.join(hooks, 'commit-msg.local');
  const temp = path.join(hooks, 'commit-msg.speclog-tmp');
  const wanted = io.readFileSync(hookSourcePath());
  io.mkdirSync(hooks, { recursive: true });

  let result: InstallResult = 'installed';
  if (io.existsSync(target)) {
    const current = io.readFileSync(target);
    if (current.length === 0) {
      // nothing to keep
    } else if (current.includes(MARKER)) {
      if (current.equals(wanted)) return 'already';
      // an older Speclog hook: upgrade in place
    } else {
      if (io.existsSync(local)) throw new HookError('bothHooksExist', `commit-msg and commit-msg.local both exist in ${hooks}; not touching them`);
      result = 'chained';
    }
  }
  const dropTemp = () => { try { io.rmSync(temp, { force: true }); } catch { /* best effort */ } };
  try {
    io.writeFileSync(temp, wanted);
    io.chmodSync(temp, 0o755);
  } catch (e) {
    dropTemp();
    throw e;
  }
  if (result === 'chained') io.renameSync(target, local);
  try {
    io.renameSync(temp, target);
  } catch (e) {
    if (result === 'chained') io.renameSync(local, target);
    dropTemp();
    throw e;
  }
  return result;
}

/** The full commit hash a (full) ref points to, or "" when it does not resolve. */
export async function resolveCommit(repoPath: string, ref: string): Promise<string> {
  if (!ref) return '';
  const r = await git(repoPath, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(r.out) ? r.out : '';
}
