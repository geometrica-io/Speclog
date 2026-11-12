// Port of ProjectManager tests/SchedulerTests.cpp (same case names) plus Speclog extras.
import { describe, it, expect, afterEach } from 'vitest';
import { dueJobs, probeStamp, RepoTimers } from '../src/scheduler';
import { TestRepo } from './helpers/testRepo';

const T = 60000;
const cleanups: Array<{ cleanup(): void }> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!.cleanup();
});

function t(last: number, busy = false, a = '', b = ''): RepoTimers {
  return { repo: 'r', lastFetchStartUnix: last, busy, lastStamp: a, seenStamp: b, retryAtUnix: 0 };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('scheduler', () => {
  it('fetch due at startup', () => {
    const j = dueJobs([t(0)], 1000, 300, true);
    expect(j).toHaveLength(1);
    expect(j[0].kind).toBe('fetch');
  });

  it('fetch due after interval', () => {
    expect(dueJobs([t(1000)], 1301, 300, true)).toHaveLength(1);
    expect(dueJobs([t(1000)], 1200, 300, true)).toHaveLength(0);
  });

  it('busy repo skipped', () => {
    expect(dueJobs([t(0, true, 'a', 'b')], 1000, 300, true)).toHaveLength(0);
  });

  it('rescan when stamp changed', () => {
    const j = dueJobs([t(1000, false, 'a', 'b')], 1100, 300, true);
    expect(j).toHaveLength(1);
    expect(j[0].kind).toBe('rescan');
    const both = dueJobs([t(0, false, 'a', 'b')], 1100, 300, true);
    expect(both).toHaveLength(2);
    expect(both[0].kind).toBe('fetch');
    expect(both[1].kind).toBe('rescan');
  });

  it('probe stamp changes on new commit', async () => {
    const r = await TestRepo.create();
    cleanups.push(r);
    expect(await probeStamp(`${r.dir}/nonexistent`)).toBe('');
    await r.commit('one', { 'a.txt': '1\n' });
    const s1 = await probeStamp(r.dir);
    expect(s1).not.toBe('');
    expect(await probeStamp(r.dir)).toBe(s1);
    await sleep(20);
    await r.commit('two', { 'a.txt': '2\n' });
    expect(await probeStamp(r.dir)).not.toBe(s1);
  }, T);

  it('fetch due exactly at interval boundary', () => {
    expect(dueJobs([t(1000)], 1300, 300, true)).toHaveLength(1);
    expect(dueJobs([t(1000)], 1299, 300, true)).toHaveLength(0);
  });

  it('a failed build is retried when due, without a change', () => {
    const x = t(1000, false, 'a', 'a');
    x.retryAtUnix = 1060;
    expect(dueJobs([x], 1059, 300, true)).toHaveLength(0);
    const j = dueJobs([x], 1060, 300, true);
    expect(j).toHaveLength(1);
    expect(j[0].kind).toBe('rescan');
    x.busy = true;
    expect(dueJobs([x], 1060, 300, true)).toHaveLength(0);
  });

  // Speclog extras.
  it('fetch disabled yields no fetch jobs', () => {
    expect(dueJobs([t(0)], 1000, 300, false)).toHaveLength(0);
    const j = dueJobs([t(0, false, 'a', 'b')], 1000, 300, false);
    expect(j).toEqual([{ repo: 'r', kind: 'rescan' }]);
  });

  it('probe stamp changes when a task file changes in the worktree only', async () => {
    const r = await TestRepo.create();
    cleanups.push(r);
    await r.commit('one', { 'docs/tasks/a.md': 'x\n', 'other.txt': '1\n' });
    const s1 = await probeStamp(r.dir);
    await sleep(20);
    r.write('other.txt', 'changed outside the task paths\n');
    expect(await probeStamp(r.dir)).toBe(s1);
    r.write('docs/tasks/a.md', 'edited, not committed\n');
    const s2 = await probeStamp(r.dir);
    expect(s2).not.toBe(s1);
    r.write('backlog/tasks/task-1.md', 'new\n');
    expect(await probeStamp(r.dir)).not.toBe(s2);
  }, T);
});
