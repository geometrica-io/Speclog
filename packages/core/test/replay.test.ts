import { describe, it, expect, afterEach } from 'vitest';
import { buildSnapshot } from '../src/snapshot';
import type { RepoInfo } from '../src/model';
import { findItem } from '../src/status';
import { ancestorsOf, commitAtDay, ReplaySession } from '../src/replay';
import { BlobReader } from '../src/git/blobReader';
import { TestRepo, makeTempDir, removeTree } from './helpers/testRepo';

const T = 120000;
const TODAY = '2026-06-01';
const cleanups: Array<{ cleanup(): void }> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!.cleanup();
});
async function repo(name = 'repo'): Promise<TestRepo> {
  const r = await TestRepo.create(name);
  cleanups.push(r);
  return r;
}
const info = (r: TestRepo, name: string): RepoInfo => ({ name, owner: '', path: r.dir, origin: '', key: r.dir });
const item = (id: string) => `## ${id} Title ${id}\nstatus: open\nsize: S\n\n`;
const file = (items: string) => `# Prog\nprogram: P\narea: A\ncreated: 2026-01-01\n\n${items}`;
const snapOf = (r: TestRepo, name = 'repo') => buildSnapshot(info(r, name), { today: TODAY });

describe('replay', () => {
  it('commitAtDay picks the last commit on or before the day', async () => {
    const r = await repo();
    await r.commit('c1', { 'docs/tasks/a.md': file(item('A1')) }, '2026-03-01T12:00:00');
    await r.commit('c2', { 'x.txt': '2' }, '2026-03-02T12:00:00');
    const c2 = await r.head();
    await r.commit('c3', { 'x.txt': '3' }, '2026-03-04T12:00:00');
    const s = await snapOf(r);
    expect(commitAtDay(s, '2026-03-03')).toBe(c2);
    expect(commitAtDay(s, '2026-02-28')).toBe('');
  }, T);

  it('commitAtDay returns empty for an empty or unknown tip', async () => {
    const r = await repo();
    await r.commit('c1', { 'x.txt': '1' }, '2026-03-01T12:00:00');
    const s = await snapOf(r);
    expect(commitAtDay({ ...s, tipHash: '' }, '2026-03-05')).toBe('');
    expect(commitAtDay({ ...s, tipHash: 'main' }, '2026-03-05')).toBe('');
  }, T);

  it('ancestorsOf excludes a commit merged later', async () => {
    const r = await repo();
    await r.commit('c1', { 'x.txt': '1' }, '2026-03-01T12:00:00');
    await r.commit('c2', { 'x.txt': '2' }, '2026-03-02T12:00:00');
    const c2 = await r.head();
    await r.git(['checkout', '-b', 'side']);
    await r.commit('side', { 'y.txt': '1' }, '2026-03-04T12:00:00');
    const side = await r.head();
    await r.git(['checkout', 'main']);
    await r.merge('side');
    const s = await snapOf(r);
    const anc = ancestorsOf(s, c2).map((c) => c.hash);
    expect(anc).toContain(c2);
    expect(anc).not.toContain(side);
    expect(anc.length).toBe(2);
    expect(s.mainCommits.length).toBeGreaterThan(anc.length);
  }, T);

  it('ReplaySession shows the board as of a day', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A')) }, '2026-03-01T12:00:00');
    await r.commit('mid', { 'x.txt': '1' }, '2026-03-02T12:00:00');
    await r.commit('close A\n\nTask: A', { 'docs/tasks/a.md': file(item('A') + item('B')) }, '2026-03-04T12:00:00');
    const s = await snapOf(r);
    const rs = new ReplaySession([s], 'unverified');
    try {
      const w2 = await rs.at('2026-03-02');
      expect(w2.error).toBe('');
      expect(findItem(w2.workspace, 'repo', 'A')!.status).toBe('open');
      expect(findItem(w2.workspace, 'repo', 'B')).toBeUndefined();
      const w4 = await rs.at('2026-03-04');
      const a = findItem(w4.workspace, 'repo', 'A')!;
      expect(a.status).toBe('done');
      expect(a.doneDate).toBe('2026-03-04');
      expect(findItem(w4.workspace, 'repo', 'B')).toBeDefined();
    } finally {
      await rs.close();
    }
  }, T);

  it('ReplaySession resolves cross-repository closes by day', async () => {
    const a = await repo('a');
    const b = await repo('b');
    await a.commit('init', { 'docs/tasks/a.md': file(item('A1')) }, '2026-03-01T12:00:00');
    await b.commit('init', { 'x.txt': '1' }, '2026-03-01T12:00:00');
    await b.commit('close\n\nTask: a:A1', { 'x.txt': '2' }, '2026-03-03T12:00:00');
    const rs = new ReplaySession([await snapOf(a, 'a'), await snapOf(b, 'b')], 'unverified');
    try {
      expect(findItem((await rs.at('2026-03-03')).workspace, 'a', 'A1')!.status).toBe('done');
      expect(findItem((await rs.at('2026-03-02')).workspace, 'a', 'A1')!.status).toBe('open');
    } finally {
      await rs.close();
    }
  }, T);

  it('a repository not yet born has no items and no error', async () => {
    const a = await repo('a');
    await a.commit('init', { 'docs/tasks/a.md': file(item('A1')) }, '2026-03-05T12:00:00');
    const rs = new ReplaySession([await snapOf(a, 'a')], 'unverified');
    try {
      const w = await rs.at('2026-03-04');
      expect(w.error).toBe('');
      expect(findItem(w.workspace, 'a', 'A1')).toBeUndefined();
    } finally {
      await rs.close();
    }
  }, T);

  it('an aborted signal yields cancelled', async () => {
    const a = await repo('a');
    await a.commit('init', { 'docs/tasks/a.md': file(item('A1')) }, '2026-03-01T12:00:00');
    const ac = new AbortController();
    const rs = new ReplaySession([await snapOf(a, 'a')], 'unverified', ac.signal);
    ac.abort();
    try {
      expect((await rs.at('2026-03-02')).error).toBe('cancelled');
    } finally {
      await rs.close();
    }
  }, T);

  it('a live snapshot error is a warning naming the repository; the data present is replayed', async () => {
    const a = await repo('a');
    await a.commit('init', { 'docs/tasks/a.md': file(item('A1')) }, '2026-03-01T12:00:00');
    const live = { ...(await snapOf(a, 'a')), error: 'git log: boom' };
    const rs = new ReplaySession([live], 'unverified');
    try {
      const r = await rs.at('2026-03-02');
      expect(r.error).toBe('');
      expect(r.warnings).toEqual([{ repo: 'a', repoPath: a.dir, message: 'git log: boom' }]);
      expect(findItem(r.workspace, 'a', 'A1')).toBeDefined();
    } finally {
      await rs.close();
    }
  }, T);

  it('a replay read failure is an error prefixed with the repository name', async () => {
    const a = await repo('a');
    await a.commit('init', { 'docs/tasks/a.md': file(item('A1')) }, '2026-03-01T12:00:00');
    const live = await snapOf(a, 'a');
    let closed = 0;
    // A reader on a folder that is not a repository: every read fails.
    const bogus = makeTempDir('notrepo');
    cleanups.push({ cleanup: () => removeTree(bogus) });
    const rs = new ReplaySession([live], 'unverified', undefined, {
      openBlobReader: (_p, signal) => {
        const r = new BlobReader(bogus, signal);
        const close = r.close.bind(r);
        r.close = async () => { closed++; await close(); };
        return r;
      },
    });
    try {
      const r = await rs.at('2026-03-02');
      expect(r.error).toMatch(/^a: ./);
    } finally {
      await rs.close();
    }
    expect(closed).toBe(1);
  }, T);

  it('a tip missing from the main history is a warning and its items show as absent', async () => {
    const a = await repo('a');
    await a.commit('init', { 'docs/tasks/a.md': file(item('A1')) }, '2026-03-01T12:00:00');
    const live = { ...(await snapOf(a, 'a')), mainCommits: [] };
    const rs = new ReplaySession([live], 'unverified');
    try {
      const r = await rs.at('2026-03-02');
      expect(r.error).toBe('');
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0].repo).toBe('a');
      expect(r.warnings[0].message).toContain(live.tipHash.slice(0, 7));
      expect(findItem(r.workspace, 'a', 'A1')).toBeUndefined();
    } finally {
      await rs.close();
    }
  }, T);

  it('a healthy repository has no warnings', async () => {
    const a = await repo('a');
    await a.commit('init', { 'docs/tasks/a.md': file(item('A1')) }, '2026-03-01T12:00:00');
    const rs = new ReplaySession([await snapOf(a, 'a')], 'unverified');
    try {
      expect((await rs.at('2026-03-02')).warnings).toEqual([]);
    } finally {
      await rs.close();
    }
  }, T);

  it('a close on a side branch counts from its merge, not its own date', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A')) }, '2026-03-01T12:00:00');
    await r.git(['checkout', '-b', 'side']);
    await r.commit('close A\n\nTask: A', { 'y.txt': '1' }, '2026-03-02T12:00:00');
    await r.git(['checkout', 'main']);
    await r.commit('main work', { 'x.txt': '1' }, '2026-03-03T12:00:00');
    const env = { GIT_AUTHOR_DATE: '2026-03-04T12:00:00', GIT_COMMITTER_DATE: '2026-03-04T12:00:00' };
    expect((await r.git(['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'], { env })).code).toBe(0);
    const rs = new ReplaySession([await snapOf(r)], 'unverified');
    try {
      expect(findItem((await rs.at('2026-03-03')).workspace, 'repo', 'A')!.status).toBe('open');
      expect(findItem((await rs.at('2026-03-04')).workspace, 'repo', 'A')!.status).toBe('done');
    } finally {
      await rs.close();
    }
  }, T);
});
