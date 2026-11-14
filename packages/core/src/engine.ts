// Scan engine: port of ProjectManager src/app/Worker.cpp. A 1 s tick probes every repository and
// rebuilds the changed ones (at most 6 at once), discovery runs every 60 s, fetches run one at a
// time with a probe + rescan after each. Every stored rebuild is published at once.
import * as fs from 'fs';
import * as path from 'path';
import { AttentionItem, FetchState, computeAttention } from './attention';
import { DiscoverError, DiscoverOptions, discoverRepos, mapLimit } from './discovery';
import { fetch } from './git/repo';
import { RECENT_DAYS, RepoInfo } from './model';
import { RepoTimers, dueJobs, probeStamp } from './scheduler';
import { RepoSnapshot, buildSnapshot, emptySnapshot, keepLastGood } from './snapshot';
import { UnverifiedMode, Workspace, resolveAll } from './status';
import { splitLines, trim } from './text';

export interface EngineConfig {
  discover: DiscoverOptions;
  fetchEnabled: boolean;
  fetchIntervalSec: number;
  unverifiedMode: UnverifiedMode;
  staleBranchDays: number;
  /** repoKey -> trust cutoff commit (Backlog.md / Spec Kit). */
  trustCommits: Record<string, string>;
}

export interface EngineClock {
  /** Unix seconds. */
  now(): number;
  /** Local date, YYYY-MM-DD. */
  today(): string;
}

/**
 * Published state. Read-only: the top-level object is frozen; the nested structures are shared
 * with the engine and must not be modified either.
 */
export interface EngineState {
  readonly workspace: Workspace;
  attention: AttentionItem[];
  /** A rescan or fetch is running. */
  busy: boolean;
  /** One per repository with an origin (others are never fetched), by RepoInfo.path. */
  fetch: FetchState[];
  /** Folders whose repository could not be read during discovery. */
  discoveryErrors: DiscoverError[];
  /** An internal failure while storing or publishing a scan ("" when none); the engine keeps running. */
  engineError: string;
}

/** Test seam: replaces the functions the engine calls to build, fetch and publish. */
export interface EngineDeps {
  buildSnapshot: typeof buildSnapshot;
  resolveAll: typeof resolveAll;
  computeAttention: typeof computeAttention;
  fetch: typeof fetch;
}

export const TICK_MS = 1000;
export const DISCOVER_SEC = 60;
/** git start-up dominates a build; repositories are independent. */
export const BUILD_CONCURRENCY = 6;
/** A failed build is retried this long after, even unchanged. */
export const ERROR_RETRY_SEC = 60;
/** Longest wait in dispose() for a running fetch. */
export const STOP_WAIT_MS = 15000;
/** A fetch failing for longer than this goes to Attention. */
export const FETCH_FAIL_SEC = 3600;
/** At most this many repositories are probed at once. */
export const PROBE_CONCURRENCY = 8;

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const systemClock: EngineClock = { now: () => Math.floor(Date.now() / 1000), today: localToday };

/**
 * git's own lock: skip this fetch, retry next tick. Discovery only admits repositories whose .git
 * is a directory; a worktree (.git file) would need `git rev-parse --git-path index.lock`.
 */
function gitLocked(repoPath: string): boolean {
  return fs.existsSync(path.join(repoPath, '.git', 'index.lock'));
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function sameFetch(a: FetchState, b: FetchState): boolean {
  return a.lastOkUnix === b.lastOkUnix && a.firstFailUnix === b.firstFailUnix && a.lastError === b.lastError;
}

export class Engine {
  private cfg: EngineConfig;
  private readonly clock: EngineClock;
  private readonly listeners = new Set<(s: EngineState) => void>();
  private readonly abort = new AbortController();
  private readonly deps: EngineDeps;

  private repos: RepoInfo[] = [];
  /** Parallel to repos. */
  private timers: RepoTimers[] = [];
  /** By RepoInfo.path. */
  private readonly snapshots = new Map<string, RepoSnapshot>();
  /** Parallel to repos. */
  private fetchStates: FetchState[] = [];
  private discoveryErrors: DiscoverError[] = [];
  private discovered = false;
  private lastDiscover = 0;
  private today = '';

  private started = false;
  private disposed = false;
  private rescanAll = false;
  private busy = false;
  private published = false;
  private timer: NodeJS.Timeout | undefined;
  private round: Promise<void> | undefined;
  private disposing: Promise<void> | undefined;
  private state: EngineState;

  constructor(cfg: EngineConfig, clock?: EngineClock, deps?: Partial<EngineDeps>) {
    this.cfg = cfg;
    this.clock = clock ?? systemClock;
    this.deps = { buildSnapshot, resolveAll, computeAttention, fetch, ...deps };
    this.state = Object.freeze({
      workspace: resolveAll([], cfg.unverifiedMode), attention: [], busy: false, fetch: [], discoveryErrors: [], engineError: '',
    });
  }

  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    this.schedule(0);
  }

  /**
   * No new jobs; running rebuilds are cancelled at once (never stored or published); a running
   * fetch is not killed (no lock files left behind) and is waited for at most STOP_WAIT_MS.
   * Repeated calls return the same promise.
   */
  dispose(): Promise<void> {
    if (!this.disposing) this.disposing = this.stop();
    return this.disposing;
  }

  private async stop(): Promise<void> {
    this.disposed = true;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.listeners.clear();
    const running = this.round;
    if (!running) return;
    let limit: NodeJS.Timeout | undefined;
    await Promise.race([running, new Promise<void>((resolve) => {
      limit = setTimeout(resolve, STOP_WAIT_MS);
      limit.unref();
    })]);
    clearTimeout(limit);
  }

  /** Rediscovers and rebuilds every repository with the new settings. */
  updateConfig(cfg: EngineConfig): void {
    this.cfg = cfg;
    this.wake();
  }

  /** Rediscovers and rebuilds every repository. */
  refresh(): void {
    this.wake();
  }

  onDidChange(listener: (s: EngineState) => void): { dispose(): void } {
    if (!this.disposed) this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  /** The latest state (frozen; see EngineState). */
  current(): EngineState {
    return this.state;
  }

  // ---- loop ----

  private schedule(ms: number): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.kick(), ms);
    this.timer.unref();
  }

  private kick(): void {
    this.timer = undefined;
    if (this.disposed || this.round) return;
    this.round = this.runRound()
      .catch(() => { /* a round never throws on purpose; the next tick tries again */ })
      .finally(() => {
        this.round = undefined;
        this.schedule(this.rescanAll ? 0 : TICK_MS);
      });
  }

  private wake(): void {
    this.rescanAll = true;
    if (this.started && !this.round) this.schedule(0);
    // A running round stops before its next fetch; the next one starts at once.
  }

  private halted(): boolean {
    return this.disposed || this.rescanAll;
  }

  private async runRound(): Promise<void> {
    const now = this.clock.now();
    this.today = this.clock.today();
    const all = this.rescanAll;
    this.rescanAll = false;
    if (all || !this.discovered || now - this.lastDiscover >= DISCOVER_SEC) await this.discover(now, all);
    if (this.disposed) return;
    try {
      await this.runJobs(now);
    } finally {
      this.setBusy(false);
    }
  }

  /** Refreshes the repository list; keeps timers, fetch states and snapshots of repositories still present. */
  private async discover(now: number, rebuildAll: boolean): Promise<void> {
    const first = !this.discovered;
    this.discovered = true;
    this.lastDiscover = now;
    let found: RepoInfo[];
    let errors: DiscoverError[];
    try {
      ({ repos: found, errors } = await discoverRepos(this.cfg.discover));
    } catch (e) {
      found = this.repos;
      errors = [{ path: '', error: `discovery: ${message(e)}` }];
    }
    if (this.disposed) return;
    const timers: RepoTimers[] = [];
    const fetchStates: FetchState[] = [];
    for (const r of found) {
      const k = this.repos.findIndex((x) => x.path === r.path);
      const t: RepoTimers = k >= 0 ? this.timers[k]
        : { repo: r.path, lastFetchStartUnix: 0, lastStamp: '', seenStamp: '', busy: false, retryAtUnix: 0 };
      if (rebuildAll) t.seenStamp = '\u0001'; // never equals a probe: forces a rescan
      timers.push(t);
      fetchStates.push(k >= 0 ? this.fetchStates[k] : { repo: r.path, lastOkUnix: 0, firstFailUnix: 0, lastError: '' });
    }
    let removed = false;
    for (const p of [...this.snapshots.keys()]) {
      if (found.some((r) => r.path === p)) continue;
      this.snapshots.delete(p);
      removed = true;
    }
    const errorsChanged = JSON.stringify(errors) !== JSON.stringify(this.discoveryErrors);
    this.repos = found;
    this.timers = timers;
    this.fetchStates = fetchStates;
    this.discoveryErrors = errors;
    // A removed repository disappears at once; new ones appear after their rescan.
    if (removed || errorsChanged || (first && found.length === 0)) {
      try {
        this.publish();
      } catch (e) {
        this.internalError(e);
      }
    }
  }

  private async runJobs(now: number): Promise<void> {
    // Local changes first, so the first view does not wait for the network.
    await this.rescanChanged();
    // One fetch at a time; after each, every repository is probed again, so a commit made while
    // a long fetch round runs shows up without waiting for the whole round.
    // A repository without origin has nothing to fetch: it never gets a fetch job.
    const fetchable = this.timers.filter((_, i) => this.repos[i].origin !== '');
    for (const j of dueJobs(fetchable, now, this.cfg.fetchIntervalSec, this.cfg.fetchEnabled)) {
      if (j.kind !== 'fetch') continue;
      if (this.halted()) return;
      const i = this.timers.findIndex((t) => t.repo === j.repo);
      if (i < 0 || gitLocked(j.repo)) continue;
      const published = await this.fetchOne(i);
      if (this.disposed) return;
      const rescanned = await this.rescanChanged();
      if (published && !rescanned) {
        try {
          this.publish();
        } catch (e) {
          this.internalError(e);
        }
      }
    }
  }

  /** Probes every repository and rebuilds the changed (or retry-due) ones; true if anything was published. */
  private async rescanChanged(): Promise<boolean> {
    if (this.halted()) return false;
    const timers = this.timers;
    const repos = this.repos;
    const stamps = await mapLimit(timers, PROBE_CONCURRENCY, (t) => {
      // specs/ is walked only where Spec Kit was found (or nothing is known yet).
      const shown = this.snapshots.get(t.repo);
      return probeStamp(t.repo, { includeSpecs: !shown || shown.formats.includes('specKit') });
    });
    if (this.halted()) return false;
    stamps.forEach((s, i) => { timers[i].lastStamp = s; });
    const rescan: number[] = [];
    for (const j of dueJobs(timers, this.clock.now(), this.cfg.fetchIntervalSec, false)) {
      const i = timers.findIndex((t) => t.repo === j.repo);
      if (j.kind === 'rescan' && i >= 0) rescan.push(i);
    }
    if (rescan.length === 0) return false;
    this.setBusy(true);
    const signal = this.abort.signal;
    const today = this.today;
    let any = false;
    // The callback never rejects, so mapLimit only settles when every build has ended: no build
    // outlives its round (no overlap, never more than BUILD_CONCURRENCY at once).
    await mapLimit(rescan, BUILD_CONCURRENCY, async (i) => {
      const repo = repos[i];
      let snap: RepoSnapshot;
      try {
        snap = await this.deps.buildSnapshot(repo, { today, trustCommit: this.cfg.trustCommits[repo.key], signal });
      } catch (e) {
        snap = { ...emptySnapshot(repo), error: `snapshot: ${message(e)}` };
      }
      try {
        if (this.store(timers[i], repo, stamps[i], snap)) {
          this.publish();
          any = true;
        }
      } catch (e) {
        this.internalError(e);
      }
    });
    return any;
  }

  /**
   * Stores a finished build. A failed one keeps the last good data (with its error shown) and is
   * retried later. False when dropped: cancelled (the stamp stays unseen) or disposed.
   */
  private store(t: RepoTimers, repo: RepoInfo, stamp: string, snap: RepoSnapshot): boolean {
    if (this.disposed || snap.error === 'cancelled') return false;
    if (!this.repos.some((r) => r.path === repo.path)) return false; // removed meanwhile
    t.seenStamp = stamp; // a change during the build re-triggers
    t.retryAtUnix = snap.error ? this.clock.now() + ERROR_RETRY_SEC : 0;
    this.snapshots.set(repo.path, keepLastGood(this.snapshots.get(repo.path), snap));
    return true;
  }

  /** Never cancelled (no lock files left behind). True if the fetch state changed. */
  private async fetchOne(i: number): Promise<boolean> {
    this.setBusy(true);
    const repo = this.repos[i];
    this.timers[i].lastFetchStartUnix = this.clock.now();
    const r = await this.deps.fetch(repo.path);
    const end = this.clock.now();
    const k = this.repos.findIndex((x) => x.path === repo.path);
    if (k < 0) return false;
    const before = this.fetchStates[k];
    const f: FetchState = { ...before };
    if (!r.error) {
      f.lastOkUnix = end;
      f.firstFailUnix = 0;
      f.lastError = '';
    } else {
      if (f.firstFailUnix === 0) f.firstFailUnix = end;
      f.lastError = splitLines(trim(r.error))[0] || 'git fetch failed';
    }
    this.fetchStates[k] = f;
    return !sameFetch(before, f);
  }

  // ---- publishing ----

  private setBusy(b: boolean): void {
    if (this.busy === b || this.disposed) return;
    this.busy = b;
    this.state = Object.freeze({ ...this.state, busy: b });
    if (this.published) this.emit();
  }

  /** A failure while storing or publishing: shown on the last state, the round goes on. */
  private internalError(e: unknown): void {
    if (this.disposed) return;
    this.state = Object.freeze({ ...this.state, busy: this.busy, engineError: `engine: ${message(e)}` });
    this.published = true;
    this.emit();
  }

  /** Throws only if resolveAll / computeAttention throw (callers catch). */
  private publish(): void {
    if (this.disposed) return;
    const snaps: RepoSnapshot[] = [];
    for (const r of this.repos) {
      const s = this.snapshots.get(r.path);
      if (s) snaps.push(s);
    }
    const workspace = this.deps.resolveAll(snaps, this.cfg.unverifiedMode);
    const fetchStates = this.fetchStates.filter((_, i) => this.repos[i].origin !== '').map((f) => ({ ...f }));
    const attention = this.deps.computeAttention(workspace, {
      today: this.today, staleBranchDays: this.cfg.staleBranchDays, recentDays: RECENT_DAYS, fetchFailSeconds: FETCH_FAIL_SEC,
    }, fetchStates, this.clock.now());
    this.state = Object.freeze({
      workspace, attention, busy: this.busy, fetch: fetchStates, discoveryErrors: [...this.discoveryErrors], engineError: '',
    });
    this.published = true;
    this.emit();
  }

  private emit(): void {
    const s = this.state;
    for (const l of [...this.listeners]) {
      try {
        l(s);
      } catch {
        // a listener's failure must not stop the engine
      }
    }
  }
}
