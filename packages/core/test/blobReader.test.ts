// Task files read through one `git cat-file --batch` process (BlobReader) and the per-build parse
// cache, including a task file whose full path is longer than Windows' 260-character limit.
import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import { buildSnapshot } from '../src/snapshot';
import type { RepoInfo } from '../src/model';
import type { ParseCache } from '../src/adapters';
import { BlobReader } from '../src/git/blobReader';
import { readBlob } from '../src/git/repo';
import { TestRepo, makeTempDir, removeTree } from './helpers/testRepo';

const T = 120000;
const cleanups: Array<{ cleanup(): void }> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!.cleanup();
});
async function repo(): Promise<TestRepo> {
  const r = await TestRepo.create();
  cleanups.push(r);
  return r;
}
const info = (r: TestRepo): RepoInfo => ({ name: 'repo', owner: '', path: r.dir, origin: '', key: r.dir });
const today = () => new Date().toISOString().slice(0, 10);

function backlogTask(n: number, status = 'To Do'): string {
  return `---\nid: task-${n}\ntitle: Item ${n}\nstatus: ${status}\nlabels: []\ndependencies: []\n---\n\nItem ${n}.\n`;
}

/** Adds content at relPath to the index and commits it; the working tree never holds the file. */
async function commitInGitOnly(r: TestRepo, relPath: string, content: string, msg: string): Promise<string> {
  const h = await r.git(['hash-object', '-w', '--stdin'], { stdin: content });
  expect(h.code).toBe(0);
  const oid = h.out.trim();
  const u = await r.git(['update-index', '--add', '--cacheinfo', `100644,${oid},${relPath}`]);
  expect(u.err).toBe('');
  const c = await r.git(['commit', '-q', '-m', msg]);
  expect(c.code).toBe(0);
  return oid;
}

/** A Backlog.md task path (as found in a2aproject/a2a-tck) padded so the full path passes 260 characters. */
function longTaskPath(r: TestRepo): string {
  const base = 'backlog/tasks/task-13 - Link-test-IDs-in-compatibility.html-to-corresponding-tests-in-tck_report.html';
  let rel = `${base}.md`;
  for (let pad = ''; path.join(r.dir, rel).length <= 300; pad += '-x') rel = `${base}${pad}.md`;
  return rel;
}

describe('long task file paths', () => {
  it('a task file past the Windows path limit is read', async () => {
    const r = await repo();
    await r.commit('init', { 'backlog/tasks/task-1 - Item-1.md': backlogTask(1) });
    const rel = longTaskPath(r);
    expect(path.join(r.dir, rel).length).toBeGreaterThan(260);
    expect(path.basename(rel).length).toBeLessThan(255);
    await commitInGitOnly(r, rel, backlogTask(13, 'Done'), 'long');

    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.error).toBe('');
    const ids = s.programs.flatMap((p) => p.items.map((i) => i.id)).sort();
    expect(ids).toEqual(['task-1', 'task-13']);

    // Also by "<ref>:<path>" (BlobReader and readBlob).
    const reader = new BlobReader(r.dir);
    const b = await reader.read(`refs/heads/main:${rel}`);
    await reader.close();
    expect(b.error).toBe('');
    expect(b.value?.text).toBe(backlogTask(13, 'Done'));
    expect((await readBlob(r.dir, 'refs/heads/main', rel)).value).toBe(backlogTask(13, 'Done'));
  }, T);
});

function isAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('BlobReader', () => {
  it('missing specs return null without an error and the reader stays usable', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/a.md': 'a\n' });
    const reader = new BlobReader(r.dir);
    try {
      const [m1, tree, m2, bad, a] = await Promise.all([
        reader.read('refs/heads/main:docs/nope.md'),
        reader.read('refs/heads/main:docs'), // a tree, not a blob
        reader.read('0'.repeat(40)),
        reader.read('refs/heads/main:docs/a.md\nrefs/heads/main:docs/a.md'), // cannot be sent
        reader.read('refs/heads/main:docs/a.md'),
      ]);
      for (const x of [m1, tree, m2, bad]) expect(x).toEqual({ value: null, error: '' });
      expect(a.error).toBe('');
      expect(a.value?.text).toBe('a\n');
      expect(a.value?.oid).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await reader.close();
    }
  }, T);

  it('content with any bytes round-trips', async () => {
    const r = await repo();
    const big = Array.from({ length: 40000 }, (_, i) => `line ${i} Yük ğüşiöç\r\n`).join(''); // ~1 MB, many chunks
    const files: Record<string, string> = {
      'f/crlf.md': 'a\r\nb\r\n',
      'f/bom.md': '﻿# Başlık\n',
      'f/utf8.md': 'Ç ğ ı İ ö ş ü — ✓ 漢字 😀\n',
      'f/missing.md': 'missing\nx missing\n0000000000000000000000000000000000000000 blob 3\nabc\n',
      'f/empty.md': '',
      'f/nonl.md': 'no newline at end',
      'f/big.md': big,
    };
    await r.commit('init', files);
    const reader = new BlobReader(r.dir);
    try {
      const names = Object.keys(files);
      // Pipelined, interleaved with missing ones.
      const got = await Promise.all(names.flatMap((n) => [reader.read(`refs/heads/main:${n}`), reader.read(`refs/heads/main:${n}.x`)]));
      names.forEach((n, i) => {
        expect(got[2 * i].error).toBe('');
        expect(got[2 * i].value?.text).toBe(files[n]);
        expect(got[2 * i + 1]).toEqual({ value: null, error: '' });
      });
    } finally {
      await reader.close();
    }
  }, T);

  it('cancel mid-read ends the process', async () => {
    const r = await repo();
    await r.commit('init', { 'big.md': 'x'.repeat(4_000_000) });
    const ac = new AbortController();
    const reader = new BlobReader(r.dir, ac.signal);
    const first = await reader.read('refs/heads/main:big.md');
    expect(first.error).toBe('');
    const pid = reader.pid;
    expect(isAlive(pid)).toBe(true);
    const pending = Array.from({ length: 20 }, () => reader.read('refs/heads/main:big.md'));
    ac.abort();
    const results = await Promise.all(pending);
    // Answers that arrived before the abort are kept; every later one is a cancel, none hangs.
    expect(results.some((x) => x.error === 'git cat-file: cancelled')).toBe(true);
    for (const x of results) expect(x.error === '' || x.error === 'git cat-file: cancelled').toBe(true);
    await reader.close();
    expect(isAlive(pid)).toBe(false);
    expect((await reader.read('refs/heads/main:big.md')).error).toBe('git cat-file: cancelled');
  }, T);

  it('an aborted signal never starts git', async () => {
    const r = await repo();
    await r.commit('init', { 'a.md': 'a' });
    const ac = new AbortController();
    ac.abort();
    const reader = new BlobReader(r.dir, ac.signal);
    expect((await reader.read('refs/heads/main:a.md')).error).toBe('git cat-file: cancelled');
    expect(reader.pid).toBeUndefined();
    await reader.close();
  }, T);

  it('git dying fails pending and later reads instead of hanging', async () => {
    const dir = makeTempDir('notrepo');
    try {
      const reader = new BlobReader(dir);
      const x = await reader.read('HEAD:a.md');
      expect(x.value).toBeNull();
      expect(x.error).toMatch(/^git cat-file: .*not a git repository/i);
      expect((await reader.read('HEAD:a.md')).error).toBe(x.error);
      await reader.close();
    } finally {
      removeTree(dir);
    }

    const r = await repo();
    await r.commit('init', { 'big.md': 'y'.repeat(4_000_000) });
    const reader = new BlobReader(r.dir);
    await reader.read('refs/heads/main:big.md');
    const pid = reader.pid!;
    const pending = Array.from({ length: 20 }, () => reader.read('refs/heads/main:big.md'));
    process.kill(pid, 'SIGKILL');
    const results = await Promise.all(pending);
    expect(results.some((y) => y.error !== '')).toBe(true);
    await reader.close();
    expect(isAlive(pid)).toBe(false);
  }, T);

  it('a read with no answer in time is a timeout and ends the process', async () => {
    // Fake cat-file: a header and part of the content, then it stalls.
    const fake = "process.stdin.once('data', () => process.stdout.write('b'.repeat(40) + ' blob 9' + String.fromCharCode(10) + 'xyz'));"
      + ' setInterval(() => undefined, 1000);';
    const reader = new BlobReader('.', undefined, { timeoutMs: 300, command: process.execPath, args: ['-e', fake] });
    const x = await reader.read('anything');
    const pid = reader.pid;
    expect(x).toEqual({ value: null, error: 'git cat-file: timed out' });
    await reader.close();
    expect(isAlive(pid)).toBe(false);
  }, T);

  it('close before any read and close twice resolve', async () => {
    const reader = new BlobReader('.');
    await reader.close();
    await reader.close();
    expect((await reader.read('HEAD:x')).error).toBe('git cat-file: closed');
  });

  it('a read during or after close fails at once as closed', async () => {
    const r = await repo();
    await r.commit('init', { 'a.md': 'a' });
    const reader = new BlobReader(r.dir);
    expect((await reader.read('refs/heads/main:a.md')).value?.text).toBe('a');
    const closing = reader.close();
    expect(await reader.read('refs/heads/main:a.md')).toEqual({ value: null, error: 'git cat-file: closed' });
    await closing;
    expect(await reader.read('refs/heads/main:a.md')).toEqual({ value: null, error: 'git cat-file: closed' });
  }, T);

  it('a slow blob that keeps flowing is not a timeout', async () => {
    // Fake cat-file: one answer of 20 bytes, one byte every 50 ms (1 s in all, timeout 400 ms).
    const fake = [
      "process.stdin.once('data', async () => {",
      "  process.stdout.write('a'.repeat(40) + ' blob 20' + String.fromCharCode(10));",
      '  for (let i = 0; i < 20; i++) { await new Promise((res) => setTimeout(res, 50)); process.stdout.write("x"); }',
      '  process.stdout.write(String.fromCharCode(10));',
      '});',
      "process.stdin.on('end', () => process.exit(0));",
    ].join('\n');
    const reader = new BlobReader('.', undefined, { timeoutMs: 400, command: process.execPath, args: ['-e', fake] });
    const x = await reader.read('anything');
    await reader.close();
    expect(x).toEqual({ value: { oid: 'a'.repeat(40), text: 'x'.repeat(20) }, error: '' });
  }, T);
});

describe('snapshot reader lifetime', () => {
  /** A reader factory for buildSnapshot that records each reader and whether close() was called. */
  function tracking(onRead?: () => void) {
    const opened: Array<{ reader: BlobReader; pid: () => number | undefined; closed: boolean }> = [];
    const open = (dir: string, signal?: AbortSignal): BlobReader => {
      const reader = new BlobReader(dir, signal);
      const rec = { reader, pid: () => reader.pid, closed: false };
      const read = reader.read.bind(reader);
      const close = reader.close.bind(reader);
      reader.read = async (spec: string) => {
        const res = await read(spec);
        onRead?.();
        return res;
      };
      reader.close = async () => {
        rec.closed = true;
        await close();
      };
      opened.push(rec);
      return reader;
    };
    return { opened, open };
  }

  it('buildSnapshot closes its reader when it finishes and when it is cancelled', async () => {
    const r = await repo();
    await r.commit('init', { 'backlog/tasks/task-1 - Item-1.md': backlogTask(1), 'backlog/tasks/task-2 - Item-2.md': backlogTask(2) });

    const ok = tracking();
    const s = await buildSnapshot(info(r), { today: today(), openBlobReader: ok.open });
    expect(s.error).toBe('');
    expect(ok.opened.length).toBe(1);
    expect(ok.opened[0].closed).toBe(true);
    expect(ok.opened[0].pid()).toBeDefined();
    expect(isAlive(ok.opened[0].pid())).toBe(false);

    const ac = new AbortController();
    const cancel = tracking(() => ac.abort()); // cancelled right after the first blob is read
    const c = await buildSnapshot(info(r), { today: today(), signal: ac.signal, openBlobReader: cancel.open });
    expect(c.error).toBe('cancelled');
    expect(cancel.opened.length).toBe(1);
    expect(cancel.opened[0].closed).toBe(true);
    expect(isAlive(cancel.opened[0].pid())).toBe(false);
  }, T);
});

describe('parse cache', () => {
  it('a file shared by main and branches is parsed once; issues keep their path', async () => {
    const r = await repo();
    const prog = (id: string) => `# Prog\nprogram: P\narea: A\ncreated: 2026-01-01\n\n## ${id} T\nstatus: open\n`;
    await r.commit('init', {
      'docs/tasks/a.md': prog('A1'), 'docs/tasks/b.md': prog('B1'),
      'docs/tasks/bad.md': '# Bad\nprogram: Q\n\n## Q1 T\nstatus: nonsense\n',
    });
    for (const n of [1, 2]) {
      await r.branch(`f${n}`);
      await r.commit(`f${n}`, { 'docs/tasks/b.md': prog(`B1${n}`) });
      await r.checkout('main');
    }
    const keys: string[] = [];
    const values = new Map<string, unknown>();
    const cache: ParseCache = {
      get<T>(key: string, compute: () => T): T {
        if (!values.has(key)) {
          keys.push(key);
          values.set(key, compute());
        }
        return values.get(key) as T;
      },
    };
    const s = await buildSnapshot(info(r), { today: today(), parseCache: cache });
    expect(s.error).toBe('');
    const parses = (file: string) => keys.filter((k) => k.startsWith('docsTasks') && k.includes(file)).length;
    expect(parses('docs/tasks/a.md')).toBe(1);
    expect(parses('docs/tasks/bad.md')).toBe(1);
    expect(parses('docs/tasks/b.md')).toBe(3); // main, f1, f2 differ
    expect(s.branches.map((b) => b.programs.length)).toEqual([3, 3]);
    expect(s.branches.flatMap((b) => b.programs.flatMap((p) => p.items.map((i) => i.id))).filter((i) => i.startsWith('B1')))
      .toEqual(['B11', 'B12']);
    // The same issue on main and both branches is reported once, at its file.
    const bad = s.issues.filter((i) => i.path === 'docs/tasks/bad.md');
    expect(bad.length).toBeGreaterThan(0);
    expect(new Set(bad.map((i) => `${i.line}:${i.kind}`)).size).toBe(bad.length);

    // Same result when nothing is cached.
    const plain = await buildSnapshot(info(r), { today: today(), parseCache: { get: (_k, compute) => compute() } });
    expect(plain.programs).toEqual(s.programs);
    expect(plain.issues).toEqual(s.issues);
    expect(plain.branches.map((b) => b.programs)).toEqual(s.branches.map((b) => b.programs));
  }, T);
});
