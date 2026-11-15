import { ChildProcess, spawn, spawnSync } from 'child_process';

export interface GitResult { code: number; out: string; err: string; launched: boolean; timedOut: boolean; cancelled: boolean; }
export interface GitOptions {
  timeoutMs?: number;
  stdin?: string;
  env?: Record<string, string>;
  signal?: AbortSignal;
  /**
   * The child is not killed by an abort or by this process exiting (fetch: git must not be
   * stopped mid-write and leave lock files). An abort only stops waiting (cancelled: true); the
   * output is still drained while this process lives. The timeout still kills, but only while
   * this process lives; once it has exited, the orphaned child's stdout/stderr are broken pipes
   * (fetch runs with --quiet, so only an error message could hit that).
   */
  survivesCancel?: boolean;
}

export const DEFAULT_TIMEOUT_MS = 120000;
/**
 * After git exits normally, wait until the pipes held by grandchildren have been idle this long
 * (restarted by each chunk), but never longer than PIPE_DRAIN_MAX_MS after the exit. After a
 * kill (timeout / abort) the wait is a one-shot PIPE_GRACE_MS.
 */
const PIPE_GRACE_MS = 200;
export const PIPE_DRAIN_MAX_MS = 2000;

/**
 * Internal test seam (not exported from the package): overrides the pipe-drain limits so tests
 * that check what output is kept do not depend on machine load.
 */
export interface RunnerTuning { pipeGraceMs?: number; pipeDrainMaxMs?: number; }

/** Kills pid and its whole process tree (taskkill /T on Windows, the process group elsewhere). */
export function killTree(pid: number | undefined): void {
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
 * timeoutMs < 0: no limit. Timeout/abort kill git and its whole process tree (an abort with
 * survivesCancel only stops waiting). The timeout is a timer of this process: it does not
 * survive this process exiting. tuning: tests only.
 */
export function runGit(repoDir: string, args: string[], opts: GitOptions = {}, tuning: RunnerTuning = {}): Promise<GitResult> {
  const result: GitResult = { code: -1, out: '', err: '', launched: false, timedOut: false, cancelled: false };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const graceMs = tuning.pipeGraceMs ?? PIPE_GRACE_MS;
  const drainMaxMs = tuning.pipeDrainMaxMs ?? PIPE_DRAIN_MAX_MS;

  if (opts.signal?.aborted) {
    result.cancelled = true;
    result.err = 'cancelled';
    return Promise.resolve(result);
  }

  return new Promise<GitResult>((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn('git', args, {
        cwd: repoDir,
        // GIT_TERMINAL_PROMPT last: no caller can turn prompting back on.
        env: { ...process.env, ...opts.env, GIT_TERMINAL_PROMPT: '0' },
        windowsHide: true,
        // POSIX: own process group, so the whole tree can be killed. Windows: outside the
        // kill-on-close job Node puts children in, so the child outlives this process.
        detached: process.platform !== 'win32' || !!opts.survivesCancel,
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
    let exited = false;
    let spawnError = '';
    let timer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;
    let drainCap: NodeJS.Timeout | undefined;
    /** Normal exit, pipes still open: each chunk restarts the idle grace (bounded by drainCap). */
    let idleDrain = false;
    let killed = false;

    const stopTimers = (): void => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      opts.signal?.removeEventListener('abort', onAbort);
    };

    const finish = (): void => {
      if (finished) return;
      finished = true;
      const detachedWait = result.cancelled && !!opts.survivesCancel && !exited;
      if (detachedWait && timer) {
        // The hard timeout still kills the child we no longer wait for (cleared on its exit).
        opts.signal?.removeEventListener('abort', onAbort);
        timer.unref();
      } else {
        stopTimers();
      }
      if (graceTimer) clearTimeout(graceTimer);
      if (drainCap) clearTimeout(drainCap);
      result.out = Buffer.concat(outChunks).toString('utf8');
      result.err = spawnError || Buffer.concat(errChunks).toString('utf8');
      if (detachedWait) {
        // Stop waiting but keep draining the pipes (git must not hit a broken pipe), and do
        // not keep this process alive for the child.
        child.unref();
        for (const s of [child.stdout, child.stderr, child.stdin]) (s as unknown as { unref?: () => void } | null)?.unref?.();
      } else {
        child.stdout?.destroy();
        child.stderr?.destroy();
      }
      resolve(result);
    };

    /** (Re)starts the grace period: finish once the pipes have been idle for PIPE_GRACE_MS. */
    const armGrace = (): void => {
      if (graceTimer) clearTimeout(graceTimer);
      graceTimer = setTimeout(finish, graceMs);
    };

    const stop = (): void => {
      if (killed) return;
      killed = true;
      idleDrain = false;
      killTree(child.pid);
      // Pipes may stay open if a grandchild escaped: one-shot grace, never restarted.
      armGrace();
    };

    const onAbort = (): void => {
      result.cancelled = true;
      if (opts.survivesCancel) finish();
      else stop();
    };

    child.on('error', (e: Error) => {
      // spawn failure (e.g. git not installed): never launched
      result.launched = false;
      spawnError = e.message;
      finish();
    });
    child.on('spawn', () => { result.launched = true; });

    const onData = (chunks: Buffer[]) => (d: Buffer): void => {
      if (finished) return;
      chunks.push(d);
      if (idleDrain) armGrace(); // pipes still active after a normal exit: keep waiting (capped)
    };
    child.stdout?.on('data', onData(outChunks));
    child.stderr?.on('data', onData(errChunks));
    // stdin errors (EPIPE when git exits early) are not fatal.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(opts.stdin ?? '');

    child.on('exit', (code) => {
      exited = true;
      result.code = code ?? -1;
      // A normal exit can no longer be reported as timed out or cancelled.
      stopTimers();
      // 'close' fires once the pipes end; a grandchild holding them must not block us.
      if (!finished && !killed) {
        idleDrain = true;
        armGrace();
        drainCap = setTimeout(finish, drainMaxMs);
      }
    });
    child.on('close', (code) => {
      if (code !== null) result.code = code;
      finish();
    });

    if (timeoutMs >= 0) {
      timer = setTimeout(() => {
        if (!finished) result.timedOut = true;
        stop();
      }, timeoutMs);
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The oldest supported git: `log --diff-merges=first-parent` needs 2.31 (`rev-parse
 * --end-of-options` 2.30, `%cs` 2.25).
 */
export const MIN_GIT_VERSION = '2.31.0';

/** Parses `git --version` output (`git version X.Y.Z(.windows.N)`); ok when >= MIN_GIT_VERSION. */
export function parseGitVersion(out: string): { ok: boolean; version: string; error: string } {
  const m = /git version (\d+)\.(\d+)\.(\d+)/.exec(out);
  if (!m) return { ok: false, version: '', error: out.trim() || 'unrecognized git version output' };
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ok = maj > 2 || (maj === 2 && min >= 31);
  return {
    ok,
    version: `${maj}.${min}.${pat}`,
    error: ok ? '' : `git ${maj}.${min}.${pat} is too old; ${MIN_GIT_VERSION} or newer is required`,
  };
}

/** Runs `git --version` and checks it against MIN_GIT_VERSION. */
export async function gitVersion(): Promise<{ ok: boolean; version: string; error: string }> {
  const r = await runGit('.', ['--version'], { timeoutMs: 15000 });
  if (!r.launched) return { ok: false, version: '', error: r.err || 'git could not be started' };
  if (r.code !== 0) return { ok: false, version: '', error: r.err || r.out.trim() || 'unrecognized git version output' };
  return parseGitVersion(r.out);
}
