import { spawn, spawnSync } from 'child_process';

export interface GitResult { code: number; out: string; err: string; launched: boolean; timedOut: boolean; cancelled: boolean; }
export interface GitOptions { timeoutMs?: number; stdin?: string; env?: Record<string, string>; signal?: AbortSignal; }

const DEFAULT_TIMEOUT_MS = 120000;
/** After the git process exits, wait this long for pipes held by grandchildren before giving up. */
const PIPE_GRACE_MS = 200;

function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true, stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // already gone
  }
}

/**
 * Runs `git <args>` with cwd = repoDir (never rejects). GIT_TERMINAL_PROMPT=0, no window.
 * timeoutMs < 0: no limit. Timeout/abort kill git and its whole process tree.
 */
export function runGit(repoDir: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  const result: GitResult = { code: -1, out: '', err: '', launched: false, timedOut: false, cancelled: false };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (opts.signal?.aborted) {
    result.cancelled = true;
    result.err = 'cancelled';
    return Promise.resolve(result);
  }

  return new Promise<GitResult>((resolve) => {
    let child;
    try {
      child = spawn('git', args, {
        cwd: repoDir,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...opts.env },
        windowsHide: true,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      result.err = (e as Error).message;
      resolve(result);
      return;
    }

    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let finished = false;
    let spawnError = '';
    let timer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (graceTimer) clearTimeout(graceTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      result.out = Buffer.concat(outChunks).toString('utf8');
      result.err = spawnError || Buffer.concat(errChunks).toString('utf8');
      child.stdout?.destroy();
      child.stderr?.destroy();
      resolve(result);
    };

    const stop = (): void => {
      killTree(child.pid);
      // Pipes may stay open if a grandchild escaped; do not wait for them.
      if (!graceTimer) graceTimer = setTimeout(finish, PIPE_GRACE_MS);
    };

    const onAbort = (): void => {
      result.cancelled = true;
      stop();
    };

    child.on('error', (e: Error) => {
      // spawn failure (e.g. git not installed): never launched
      result.launched = false;
      spawnError = e.message;
      finish();
    });
    child.on('spawn', () => { result.launched = true; });

    child.stdout?.on('data', (d: Buffer) => outChunks.push(d));
    child.stderr?.on('data', (d: Buffer) => errChunks.push(d));
    // stdin errors (EPIPE when git exits early) are not fatal.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(opts.stdin ?? '');

    child.on('exit', (code) => {
      result.code = code ?? -1;
      // 'close' fires once the pipes end; a grandchild holding them must not block us.
      if (!graceTimer) graceTimer = setTimeout(finish, PIPE_GRACE_MS);
    });
    child.on('close', (code) => {
      if (code !== null) result.code = code;
      finish();
    });

    if (timeoutMs >= 0) {
      timer = setTimeout(() => {
        result.timedOut = true;
        stop();
      }, timeoutMs);
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Parses `git version X.Y.Z(.windows.N)`; ok when >= 2.24.0. */
export async function gitVersion(): Promise<{ ok: boolean; version: string; error: string }> {
  const r = await runGit('.', ['--version'], { timeoutMs: 15000 });
  if (!r.launched) return { ok: false, version: '', error: r.err || 'git could not be started' };
  const m = /git version (\d+)\.(\d+)\.(\d+)/.exec(r.out);
  if (r.code !== 0 || !m) return { ok: false, version: '', error: r.err || r.out.trim() || 'unrecognized git version output' };
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ok = maj > 2 || (maj === 2 && min >= 24);
  return {
    ok,
    version: `${maj}.${min}.${pat}`,
    error: ok ? '' : `git ${maj}.${min}.${pat} is too old; 2.24.0 or newer is required`,
  };
}
