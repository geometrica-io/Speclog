// Engine: discovery, change probe, rescans, fetches and publishing (port of ProjectManager
// src/app/Worker.cpp behavior), run against real git repositories with a fake clock.
import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Engine, EngineConfig, EngineState, STOP_WAIT_MS } from '../src/engine';
import type { fetch as realFetch } from '../src/git/repo';
import { buildSnapshot } from '../src/snapshot';
import { computeAttention } from '../src/attention';
import { TestRepo, TestRemote, removeTree } from './helpers/testRepo';

const T = 90000;
const cleanups: Array<{ cleanup(): void }> = [];
const engines: Engine[] = [];
afterEach(async () => {
  while (engines.length) await engines.pop()!.dispose();
  while (cleanups.length) cleanups.pop()!.cleanup();
});

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Fake clock: unix seconds move only when the test says so. */
class FakeClock {
  t = Math.floor(Date.now() / 1000);
  now(): number { return this.t; }
  today(): string { return ymd(new Date(this.t * 1000)); }
}

function taskFile(ids: string[]): string {
  return `# Prog\nprogram: P\narea: A\ncreated: 2026-01-01\n\n${ids.map((id) => `## ${id} Title ${id}\nstatus: open\n`).join('\n')}`;
}

/** A repository (named by its folder, no origin) with one docs/tasks file. */
async function repo(name: string, ids: string[]): Promise<TestRepo> {
  const r = await TestRepo.create(name);
  cleanups.push(r);
  await r.commit('init', { 'docs/tasks/p.md': taskFile(ids) });
  return r;
}

/** Each repository is opened as a workspace folder. */
function config(repos: TestRepo[], over: Partial<EngineConfig> = {}): EngineConfig {
  return {
    discover: { workspaceFolders: repos.map((r) => r.dir), roots: [], exclude: [], originFilter: [] },
    fetchEnabled: false,
    fetchIntervalSec: 300,
    unverifiedMode: 'unverified',
    staleBranchDays: 7,
    trustCommits: {},
    ...over,
  };
}

function engine(cfg: EngineConfig, clock = new FakeClock()): Engine {
  const e = new Engine(cfg, clock);
  engines.push(e);
  return e;
}

/** Resolves with the first published state (current or later) that satisfies pred. */
function waitFor(e: Engine, pred: (s: EngineState) => boolean, ms = 30000): Promise<EngineState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.dispose();
      reject(new Error('timed out waiting for engine state'));
    }, ms);
    const sub = e.onDidChange((s) => {
      if (!pred(s)) return;
      clearTimeout(timer);
      sub.dispose();
      resolve(s);
    });
  });
}

const ids = (s: EngineState) => s.workspace.items.map((i) => i.item.id).sort();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('engine', () => {
  it('first publish after initial scan', async () => {
    const r = await repo('alpha', ['A1', 'A2']);
    const e = engine(config([r]));
    const first = waitFor(e, () => true);
    e.start();
    const s = await first;
    expect(s.workspace.snapshots.map((x) => x.repo.name)).toEqual([path.basename(r.dir)]);
    expect(ids(s)).toEqual(['A1', 'A2']);
    expect(s.discoveryErrors).toEqual([]);
    expect(e.current().workspace.items).toHaveLength(2);
  }, T);

  it('commit in a repo triggers rescan and publish', async () => {
    const r = await repo('alpha', ['A1']);
    const e = engine(config([r]));
    const first = waitFor(e, (s) => s.workspace.items.length === 1);
    e.start();
    await first;
    const next = waitFor(e, (s) => ids(s).includes('A2'));
    await r.commit('Add A2', { 'docs/tasks/p.md': taskFile(['A1', 'A2']) });
    expect(ids(await next)).toEqual(['A1', 'A2']);
  }, T);

  it('config change rescans all', async () => {
    const a = await repo('alpha', ['A1']);
    const b = await repo('beta', ['B1']);
    const e = engine(config([a, b]));
    const first = waitFor(e, (s) => s.workspace.snapshots.length === 2);
    e.start();
    const keys = (await first).workspace.snapshots.map((x) => x.repo.key); // alpha, beta (sorted by name)
    const ha = await a.head();
    const hb = await b.head();
    // The trust cutoff is read by the snapshot build, so it shows only after a rescan of each repo.
    const trusted = waitFor(e, (s) => s.workspace.snapshots.every((x) => x.trustCommit !== ''));
    e.updateConfig(config([a, b], { trustCommits: { [keys[0]]: ha, [keys[1]]: hb } }));
    const s = await trusted;
    expect(s.workspace.snapshots.map((x) => x.trustCommit)).toEqual([ha, hb]);
  }, T);

  it('dispose during scan cancels and does not publish', async () => {
    const repos = [await repo('alpha', ['X1']), await repo('beta', ['X1']), await repo('gamma', ['X1'])];
    const e = engine(config(repos));
    let published = 0;
    e.onDidChange(() => ++published);
    e.start();
    while (!e.current().busy) await new Promise((r) => setImmediate(r));
    const t0 = Date.now();
    await e.dispose();
    expect(Date.now() - t0).toBeLessThan(5000);
    await sleep(1500);
    expect(published).toBe(0);
    expect(e.current().workspace.snapshots).toHaveLength(0);
  }, T);

  it('fetch disabled never fetches', async () => {
    const remote = await TestRemote.create('alpha');
    cleanups.push(remote);
    await remote.pushRemoteOnlyBranch('feature/x', 'x.txt');
    // origin/feature/x exists only on the remote now; a fetch would bring it back.
    expect((await remote.work.git(['update-ref', '-d', 'refs/remotes/origin/feature/x'])).code).toBe(0);
    const e = engine(config([remote.work], { fetchEnabled: false }));
    const first = waitFor(e, () => true);
    e.start();
    await first;
    await sleep(2500);
    const ref = await remote.work.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/feature/x']);
    expect(ref.code).not.toBe(0);
    expect(e.current().fetch.every((f) => f.lastOkUnix === 0 && f.firstFailUnix === 0)).toBe(true);
  }, T);

  it('fetch enabled fetches and then rescans', async () => {
    const remote = await TestRemote.create('alpha');
    cleanups.push(remote);
    await remote.pushRemoteOnlyBranch('feature/x', 'x.txt');
    expect((await remote.work.git(['update-ref', '-d', 'refs/remotes/origin/feature/x'])).code).toBe(0);
    const clock = new FakeClock();
    const e = engine(config([remote.work], { fetchEnabled: true }), clock);
    e.start();
    const s = await waitFor(e, (x) => x.fetch.some((f) => f.lastOkUnix !== 0) &&
      x.workspace.snapshots.some((y) => y.branches.some((b) => b.tip.name === 'origin/feature/x')));
    expect(s.fetch[0].lastOkUnix).toBe(clock.t);
    const ref = await remote.work.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/feature/x']);
    expect(ref.code).toBe(0);
  }, T);

  it('a failing repo keeps last good data and adds gitError', async () => {
    const r = await repo('alpha', ['A1', 'A2']);
    const clock = new FakeClock();
    const e = engine(config([r]), clock);
    const first = waitFor(e, (s) => s.workspace.items.length === 2);
    e.start();
    await first;
    // A new commit whose object is gone: the stamp changes and the rebuild fails.
    await r.commit('broken', { 'docs/tasks/p.md': taskFile(['A1', 'A2', 'A3']) });
    const head = await r.head();
    const obj = path.join(r.dir, '.git', 'objects', head.slice(0, 2), head.slice(2));
    fs.chmodSync(obj, 0o666);
    fs.unlinkSync(obj);
    const failed = await waitFor(e, (s) => s.workspace.snapshots.some((x) => x.error !== ''));
    expect(ids(failed)).toEqual(['A1', 'A2']);
    expect(failed.attention.some((a) => a.kind === 'gitError' && a.repo === path.basename(r.dir))).toBe(true);
    // Retried after 60 s on the clock, still without a change; still the last good data.
    let republished = 0;
    const sub = e.onDidChange(() => ++republished);
    clock.t += 61;
    await sleep(2500);
    sub.dispose();
    expect(republished).toBeGreaterThan(0);
    expect(ids(e.current())).toEqual(['A1', 'A2']);
  }, T);

  it('a removed repository disappears at the next discovery', async () => {
    const a = await repo('alpha', ['A1']);
    const b = await repo('beta', ['B1']);
    const clock = new FakeClock();
    const e = engine(config([a, b]), clock);
    const first = waitFor(e, (s) => s.workspace.snapshots.length === 2);
    e.start();
    await first;
    const gone = waitFor(e, (s) => s.workspace.snapshots.length === 1);
    removeTree(b.dir);
    clock.t += 61; // next discovery
    const s = await gone;
    expect(s.workspace.snapshots[0].repo.name).toBe(path.basename(a.dir));
  }, T);

  it('a throw while publishing does not break the round or let builds overlap', async () => {
    const a = await repo('alpha', ['A1']);
    const b = await repo('beta', ['B1']);
    const active = new Set<string>();
    let overlap = false;
    let maxActive = 0;
    // beta's first build outlasts several ticks: a round that ended early (rejected on alpha's
    // publish) would start a second beta build next to it.
    const slow = await fs.promises.realpath(b.dir);
    let slowLeft = 1;
    const build: typeof buildSnapshot = async (r, o) => {
      if (active.has(r.path)) overlap = true;
      active.add(r.path);
      maxActive = Math.max(maxActive, active.size);
      try {
        if (r.path === slow && slowLeft-- > 0) await sleep(3000);
        return await buildSnapshot(r, o);
      } finally {
        active.delete(r.path);
      }
    };
    let throwing = true;
    const attention: typeof computeAttention = (...args) => {
      if (throwing) throw new Error('boom');
      return computeAttention(...args);
    };
    const e = new Engine(config([a, b]), new FakeClock(), { buildSnapshot: build, computeAttention: attention });
    engines.push(e);
    const failed = waitFor(e, (s) => s.engineError.includes('boom'));
    e.start();
    await failed;
    // The round still ends (busy cleared) although every publish threw.
    await waitFor(e, (s) => !s.busy && s.engineError !== '');
    throwing = false;
    const next = waitFor(e, (s) => ids(s).includes('A2') && s.engineError === '');
    await a.commit('Add A2', { 'docs/tasks/p.md': taskFile(['A1', 'A2']) });
    const s = await next;
    expect(ids(s)).toEqual(['A1', 'A2', 'B1']);
    expect(overlap).toBe(false);
    expect(maxActive).toBeLessThanOrEqual(2);
  }, T);

  it('a throwing listener does not break the engine', async () => {
    const r = await repo('alpha', ['A1']);
    const e = engine(config([r]));
    e.onDidChange(() => { throw new Error('listener'); });
    const first = waitFor(e, (s) => s.workspace.items.length === 1);
    e.start();
    await first;
    const next = waitFor(e, (s) => ids(s).includes('A2'));
    await r.commit('Add A2', { 'docs/tasks/p.md': taskFile(['A1', 'A2']) });
    expect(ids(await next)).toEqual(['A1', 'A2']);
  }, T);

  it('updateConfig during a running round ends with results under the new config', async () => {
    const a = await repo('alpha', ['A1']);
    const b = await repo('beta', ['B1']);
    const keyA = await fs.promises.realpath(a.dir);
    const keyB = await fs.promises.realpath(b.dir);
    const ha = await a.head();
    const hb = await b.head();
    const e = engine(config([a, b]));
    e.start();
    while (!e.current().busy) await new Promise((r) => setImmediate(r));
    e.updateConfig(config([a, b], { trustCommits: { [keyA]: ha, [keyB]: hb } }));
    const done = await waitFor(e, (s) => !s.busy && s.workspace.snapshots.length === 2 &&
      s.workspace.snapshots.every((x) => x.trustCommit !== ''));
    expect(done.workspace.snapshots.map((x) => x.trustCommit)).toEqual([ha, hb]);
    await sleep(1500);
    expect(e.current().workspace.snapshots.map((x) => x.trustCommit)).toEqual([ha, hb]);
  }, T);

  it('dispose returns the same promise and the state is frozen', async () => {
    const r = await repo('alpha', ['A1']);
    const e = engine(config([r]));
    const first = waitFor(e, () => true);
    e.start();
    const s = await first;
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(e.current())).toBe(true);
    const p1 = e.dispose();
    expect(e.dispose()).toBe(p1);
    await p1;
  }, T);

  it('a repository without origin is never fetched and never shown as failing', async () => {
    const local = await repo('alpha', ['A1']); // no origin
    const remote = await TestRemote.create('beta');
    cleanups.push(remote);
    const fetched: string[] = [];
    const fakeFetch: typeof realFetch = async (p) => {
      fetched.push(p);
      // A new message each time: every failure is published (and Attention recomputed).
      const err = `fatal: boom ${fetched.length}`;
      return { value: { code: 128, out: '', err, launched: true, timedOut: false, cancelled: false }, error: `git fetch: ${err}` };
    };
    const clock = new FakeClock();
    const e = new Engine(config([local, remote.work], { fetchEnabled: true, fetchIntervalSec: 30 }), clock, { fetch: fakeFetch });
    engines.push(e);
    e.start();
    const first = await waitFor(e, (s) => s.workspace.snapshots.length === 2 && s.fetch.some((f) => f.firstFailUnix !== 0));
    const remotePath = first.workspace.snapshots.find((x) => x.repo.origin !== '')!.repo.path;
    // Fetches are due again on every tick: the local-only repository never gets one.
    for (let k = 0; k < 3; k++) {
      clock.t += 4000;
      await sleep(1200);
    }
    expect(fetched.length).toBeGreaterThan(0);
    expect(fetched.every((p) => p === remotePath)).toBe(true);
    const s = e.current();
    expect(s.fetch.map((f) => f.repo)).toEqual([remotePath]);
    const failing = s.attention.filter((a) => a.kind === 'fetchFailing');
    expect(failing.every((a) => a.repoPath === remotePath)).toBe(true);
    expect(failing.length).toBeGreaterThan(0);
  }, T);

  it('dispose waits at most STOP_WAIT_MS for a fetch that never ends', async () => {
    const remote = await TestRemote.create('alpha');
    cleanups.push(remote);
    let started!: () => void;
    const fetchStarted = new Promise<void>((r) => { started = r; });
    const hanging: typeof realFetch = () => {
      started();
      return new Promise(() => undefined);
    };
    const e = new Engine(config([remote.work], { fetchEnabled: true }), new FakeClock(), { fetch: hanging });
    engines.push(e);
    e.start();
    await fetchStarted;
    vi.useFakeTimers();
    try {
      let done = false;
      const p = e.dispose().then(() => { done = true; });
      await vi.advanceTimersByTimeAsync(STOP_WAIT_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await p;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  }, T);
});
