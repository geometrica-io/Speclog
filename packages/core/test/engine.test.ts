// Engine: discovery, change probe, rescans, fetches and publishing (port of ProjectManager
// src/app/Worker.cpp behavior), run against real git repositories with a fake clock.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { Engine, EngineConfig, EngineState } from '../src/engine';
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
});
