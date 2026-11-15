// Blob contents through one long-lived `git cat-file --batch` process. Unlike `git show
// <ref>:<path>`, cat-file never stats its argument as a file, so a path past the Windows path
// limit is read; and one process serves every read of a snapshot build.
import { ChildProcess, spawn } from 'child_process';
import { DEFAULT_TIMEOUT_MS, PIPE_DRAIN_MAX_MS, killTree } from './runner';
import type { RepoResult } from './repo';

export interface Blob { oid: string; text: string; }

interface Pending {
  resolve: (r: RepoResult<Blob | null>) => void;
}

/** `<oid> <type> <size>`: content of size bytes and a newline follow. */
const HEADER_RE = /^([0-9a-fA-F]{40}|[0-9a-fA-F]{64}) (\S+) (\d+)$/;

/**
 * Reads blobs by object id or `<rev>:<path>` through one `git cat-file --batch` process, started
 * on the first read. Same rules as runGit: GIT_TERMINAL_PROMPT=0, no window, the process tree is
 * killed on abort or timeout (no answer within timeoutMs while a read is pending, < 0: no limit).
 * read() never rejects; after git dies (or an abort) every pending and later read returns an
 * error. close() must be called when done (also on error and cancel).
 */
export class BlobReader {
  private child: ChildProcess | undefined;
  private readonly queue: Pending[] = [];
  private chunks: Buffer[] = [];
  private buffered = 0;
  /** Header of the response being received: content size, oid, type; undefined before the header. */
  private current: { size: number; oid: string; type: string } | undefined;
  /** Why the reader stopped ("" while usable). */
  private dead = '';
  private exited = false;
  private watchdog: NodeJS.Timeout | undefined;
  private errTail = '';
  private readonly timeoutMs: number;
  private closeWaiters: Array<() => void> = [];
  private readonly onAbort = (): void => this.die('cancelled');

  constructor(private readonly repo: string, private readonly signal?: AbortSignal, opts: { timeoutMs?: number } = {}) {
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The git process id once started (tests). */
  get pid(): number | undefined { return this.child?.pid; }

  /**
   * Content (UTF-8) of spec: an object id or `<rev>:<path>`. value null without an error when it
   * names no blob (missing, ambiguous, not a blob) or cannot be requested (a newline in it).
   */
  read(spec: string): Promise<RepoResult<Blob | null>> {
    if (this.signal?.aborted) this.die('cancelled');
    if (this.dead) return Promise.resolve(this.failed());
    // One request per line: a newline (or a trailing CR, which git strips) cannot be sent.
    if (spec === '' || spec.includes('\n') || spec.endsWith('\r')) return Promise.resolve({ value: null, error: '' });
    if (!this.child && !this.start()) return Promise.resolve(this.failed());
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      if (!this.watchdog) this.arm();
      this.child!.stdin!.write(`${spec}\n`);
    });
  }

  /** Ends the process: git exits on end of input; killed if it has not after a short wait. */
  close(): Promise<void> {
    if (!this.child || this.exited) {
      this.die('closed');
      return Promise.resolve();
    }
    if (this.queue.length > 0 || this.dead) {
      this.die('closed');
    } else {
      this.child.stdin?.end();
    }
    return new Promise((resolve) => {
      if (this.exited) { resolve(); return; }
      let t: NodeJS.Timeout | undefined;
      const done = () => { if (t) clearTimeout(t); resolve(); };
      // Not exited in time: killed, and no longer waited for.
      t = setTimeout(() => { this.die('closed'); this.closeWaiters = this.closeWaiters.filter((w) => w !== done); resolve(); },
        PIPE_DRAIN_MAX_MS);
      this.closeWaiters.push(done);
    });
  }

  private failed(): RepoResult<Blob | null> {
    return { value: null, error: `git cat-file: ${this.dead}` };
  }

  private start(): boolean {
    let child: ChildProcess;
    try {
      child = spawn('git', ['cat-file', '--batch'], {
        cwd: this.repo,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        windowsHide: true,
        // POSIX: own process group, so killTree reaches the whole tree.
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      this.dead = (e as Error).message || 'git could not be started';
      return false;
    }
    this.child = child;
    child.on('error', (e: Error) => {
      if (child.pid === undefined) this.exited = true; // never started: no exit event follows
      this.die(e.message || 'git could not be started');
    });
    child.stdin?.on('error', () => undefined); // EPIPE when git exits early: reported by exit
    child.stdout?.on('data', (d: Buffer) => this.onData(d));
    child.stderr?.on('data', (d: Buffer) => { this.errTail = (this.errTail + d.toString('utf8')).slice(-2000); });
    const ended = (code: number | null) => {
      const why = this.errTail.trim().split(/\r?\n/)[0] || `exit code ${code ?? -1}`;
      this.die(why);
    };
    child.on('exit', (code) => {
      this.exited = true;
      // 'close' follows once the pipes end; a process holding them must not keep reads waiting.
      const t = setTimeout(() => ended(code), PIPE_DRAIN_MAX_MS);
      t.unref();
      child.once('close', () => clearTimeout(t));
    });
    child.on('close', (code) => {
      this.exited = true;
      ended(code);
    });
    this.signal?.addEventListener('abort', this.onAbort, { once: true });
    return true;
  }

  /** (Re)starts the no-progress timer while reads are pending. */
  private arm(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = undefined;
    if (this.timeoutMs < 0 || this.queue.length === 0 || this.dead) return;
    this.watchdog = setTimeout(() => this.die('timed out'), this.timeoutMs);
  }

  private onData(d: Buffer): void {
    if (this.dead) return;
    this.chunks.push(d);
    this.buffered += d.length;
    while (this.buffered > 0 && !this.dead) {
      if (this.queue.length === 0) { this.die('unexpected output'); return; }
      if (!this.current) {
        const buf = this.take();
        const nl = buf.indexOf(10);
        if (nl === -1) return;
        const header = buf.toString('utf8', 0, nl);
        this.keep(buf.subarray(nl + 1));
        const m = HEADER_RE.exec(header);
        // "<spec> missing" / "<spec> ambiguous": nothing follows.
        if (!m) { this.answer({ value: null, error: '' }); continue; }
        this.current = { oid: m[1], type: m[2], size: Number(m[3]) };
      }
      const need = this.current.size + 1;
      if (this.buffered < need) return;
      const buf = this.take();
      if (buf[need - 1] !== 10) { this.die('unexpected output'); return; }
      const { oid, type, size } = this.current;
      const text = type === 'blob' ? buf.toString('utf8', 0, size) : null;
      this.current = undefined;
      this.keep(buf.subarray(need));
      this.answer({ value: text === null ? null : { oid, text }, error: '' });
    }
  }

  /** Everything buffered as one Buffer (kept buffered). */
  private take(): Buffer {
    if (this.chunks.length > 1) this.chunks = [Buffer.concat(this.chunks)];
    return this.chunks[0] ?? Buffer.alloc(0);
  }

  private keep(rest: Buffer): void {
    this.chunks = rest.length > 0 ? [rest] : [];
    this.buffered = rest.length;
  }

  private answer(r: RepoResult<Blob | null>): void {
    this.queue.shift()!.resolve(r);
    this.arm();
  }

  /** Stops for good: kills git unless it has exited, fails every pending read. */
  private die(why: string): void {
    if (!this.dead) {
      this.dead = why;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.watchdog = undefined;
      this.signal?.removeEventListener('abort', this.onAbort);
      if (this.child && !this.exited) killTree(this.child.pid);
      this.child?.stdin?.destroy();
      this.child?.stdout?.destroy();
      this.child?.stderr?.destroy();
      this.chunks = [];
      this.buffered = 0;
      for (const p of this.queue.splice(0)) p.resolve(this.failed());
    }
    if (this.exited || !this.child) {
      for (const w of this.closeWaiters.splice(0)) w();
    }
  }
}
