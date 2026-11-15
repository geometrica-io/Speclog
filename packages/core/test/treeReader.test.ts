// Task file listing through the build's `git cat-file --batch` process (TreeReader): the same
// files, object ids and order as `git ls-tree -r`, with trees cached by object id.
import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { BlobReader } from '../src/git/blobReader';
import { TreeReader } from '../src/git/treeReader';
import { listTreeBlobs } from '../src/git/repo';
import { runGit } from '../src/git/runner';
import { TestRepo, makeTempDir, removeTree } from './helpers/testRepo';

const T = 120000;
const cleanups: Array<{ cleanup(): void }> = [];
const readers: BlobReader[] = [];
afterEach(async () => {
  while (readers.length) await readers.pop()!.close();
  while (cleanups.length) cleanups.pop()!.cleanup();
});
async function repo(): Promise<TestRepo> {
  const r = await TestRepo.create();
  cleanups.push(r);
  return r;
}
function open(r: TestRepo): BlobReader {
  const b = new BlobReader(r.dir);
  readers.push(b);
  return b;
}

async function must(r: TestRepo, args: string[], stdin?: string): Promise<string> {
  const g = await r.git(args, stdin === undefined ? {} : { stdin });
  expect(g.code, `git ${args.join(' ')}: ${g.err}`).toBe(0);
  return g.out.trim();
}

/** Stages content at relPath with mode (index only; the working tree never holds it). */
async function stage(r: TestRepo, mode: string, relPath: string, content: string): Promise<void> {
  const oid = await must(r, ['hash-object', '-w', '--stdin'], content);
  await must(r, ['update-index', '--add', '--cacheinfo', `${mode},${oid},${relPath}`]);
}

/** `git ls-tree -r --name-only` of ref under specs, blobs only (a submodule is not a file). */
async function lsTreeNames(r: TestRepo, ref: string, specs: string[]): Promise<string[]> {
  const g = await r.git(['-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', '--name-only', '--end-of-options', ref, ...specs]);
  expect(g.code).toBe(0);
  const types = await r.git(['ls-tree', '-r', '-z', '--format=%(objecttype)', '--end-of-options', ref, ...specs]);
  expect(types.code).toBe(0);
  const t = types.out.split('\0');
  return g.out.split('\0').filter((s, i) => s !== '' && t[i] === 'blob');
}

describe('TreeReader', () => {
  it('lists the same files, ids and order as git ls-tree -r', async () => {
    const r = await repo();
    await r.commit('init', {
      'specs/001 feature/tasks.md': 't', 'specs/001 feature/sub dir/deep.md': 'd',
      'specs/Çalışma ğüş/görev ı.md': 'g', 'specs/a-b.md': 'ab', 'specs/a/x.md': 'ax', 'specs/a.md': 'a.',
      'backlog.config.yml': 'r', 'backlogx.txt': 'n', 'backlog/tasks/task-1 - Çay.md': 'c',
      'docs/tasks/a.md': 'da', 'docs/other.md': 'o', 'other/x.md': 'x',
    });
    await stage(r, '100755', 'specs/run.sh', '#!/bin/sh\n');
    await stage(r, '120000', 'specs/link.md', 'a.md');
    const head = await r.head();
    await must(r, ['update-index', '--add', '--cacheinfo', `160000,${head},specs/sub module`]);
    let long = 'specs/002-long/tasks';
    while (path.join(r.dir, long).length <= 300) long += '/dir-with-a-long-name';
    long += '/tasks.md';
    await stage(r, '100644', long, 'long');
    await must(r, ['commit', '-q', '-m', 'modes']);
    // An empty subtree (only possible through mktree): lists nothing, like ls-tree.
    const empty = await must(r, ['mktree'], '');
    const rootLines = await must(r, ['ls-tree', 'HEAD']);
    const root = await must(r, ['mktree'], `${rootLines}\n040000 tree ${empty}\tempty\n`);
    const commit = await must(r, ['commit-tree', root, '-p', 'HEAD', '-m', 'empty tree']);
    await must(r, ['update-ref', 'refs/heads/main', commit]);

    const tr = new TreeReader(open(r));
    const ref = 'refs/heads/main';
    const cases = [
      ['specs/', 'backlog.config.yml', 'backlog/', 'docs/tasks/', 'none/', 'empty/'],
      ['specs/'], ['empty/'], ['empty'], ['specs/a.md'], ['specs/a.md/'], ['specs', 'specs/001 feature/'],
      ['backlog.config.yml/'], ['specs/001 feature/sub dir/'], ['specs/run.sh', 'specs/link.md', 'specs/sub module'],
    ];
    for (const specs of cases) {
      const got = await tr.listBlobs(ref, specs);
      expect(got.error).toBe('');
      const old = await listTreeBlobs(r.dir, ref, specs);
      expect(old.error).toBe('');
      expect(got.value, specs.join(',')).toEqual(old.value);
      expect(got.value.map((f) => f.path)).toEqual(await lsTreeNames(r, ref, specs));
    }
    const all = (await tr.listBlobs(ref, cases[0])).value.map((f) => f.path);
    expect(all).toContain(long);
    expect(all).toContain('specs/Çalışma ğüş/görev ı.md');
    expect(all).toContain('specs/run.sh');
    expect(all).toContain('specs/link.md'); // a symlink is a blob, as in ls-tree
    expect(all).not.toContain('specs/sub module'); // a submodule is a commit, not a blob
    expect(all.some((p) => p.startsWith('empty'))).toBe(false);
    expect((await tr.listBlobs(ref, [])).value).toEqual([]);
  }, T);

  it('a subtree shared by two branches is parsed once', async () => {
    const r = await repo();
    await r.commit('init', { 'specs/shared/a.md': 'a', 'specs/shared/deep/b.md': 'b', 'specs/own/c.md': 'c' });
    await r.branch('feature');
    await r.commit('own', { 'specs/own/c.md': 'c2' });
    const reader = open(r);
    const reads: string[] = [];
    const readRaw = reader.readRaw.bind(reader);
    reader.readRaw = (spec: string) => { reads.push(spec); return readRaw(spec); };
    const tr = new TreeReader(reader);

    const m = await tr.listBlobs('refs/heads/main', ['specs/']);
    expect(m.value.map((f) => f.path)).toEqual(['specs/own/c.md', 'specs/shared/a.md', 'specs/shared/deep/b.md']);
    // root, specs, own, shared, shared/deep
    expect(tr.treesParsed).toBe(5);
    const f = await tr.listBlobs('refs/heads/feature', ['specs/']);
    expect(f.value.map((x) => x.path)).toEqual(['specs/own/c.md', 'specs/shared/a.md', 'specs/shared/deep/b.md']);
    expect(f.value[0].oid).not.toBe(m.value[0].oid);
    // New: root, specs, own; shared and shared/deep come from the cache.
    expect(tr.treesParsed).toBe(8);
    const shared = await must(r, ['rev-parse', 'refs/heads/main:specs/shared']);
    expect(reads.filter((s) => s === shared)).toHaveLength(1);
    // The same ref again: only its root tree is requested.
    await tr.listBlobs('refs/heads/main', ['specs/']);
    expect(tr.treesParsed).toBe(8);
  }, T);

  it('reads a zero-padded 040000 tree mode as a tree, like ls-tree', async () => {
    const r = await repo();
    await r.commit('init', { 'specs/a.md': 'a' });
    const blob = await must(r, ['hash-object', '-w', '--stdin'], 'deep');
    // Old imported histories hold zero-padded modes (fsck zeroPaddedFilemode); git reads them as octal.
    const entry = (mode: string, name: string, oid: string) =>
      Buffer.concat([Buffer.from(`${mode} ${name}\0`), Buffer.from(oid, 'hex')]);
    const writeTree = (data: Buffer): string => {
      const w = spawnSync('git', ['hash-object', '-t', 'tree', '--literally', '-w', '--stdin'], { cwd: r.dir, input: data });
      expect(w.status, String(w.stderr)).toBe(0);
      return String(w.stdout).trim();
    };
    const inner = writeTree(entry('100644', 'deep.md', blob));
    const root = writeTree(Buffer.concat([entry('040000', 'specs', inner), entry('100644', 'z.md', blob)]));
    const commit = await must(r, ['commit-tree', root, '-m', 'padded']);
    await must(r, ['update-ref', 'refs/heads/padded', commit]);
    const got = await new TreeReader(open(r)).listBlobs('refs/heads/padded', ['specs/', 'z.md']);
    expect(got.error).toBe('');
    expect(got.value.map((f) => f.path)).toEqual(['specs/deep.md', 'z.md']);
    expect(got.value.map((f) => f.path)).toEqual(await lsTreeNames(r, 'refs/heads/padded', ['specs/', 'z.md']));
  }, T);

  it('a missing path is an empty list; a missing ref is an error', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/a.md': 'a' });
    const tr = new TreeReader(open(r));
    const none = await tr.listBlobs('refs/heads/main', ['specs/', 'docs/a.md/x', 'docs/b.md']);
    expect(none).toEqual({ value: [], error: '' });
    const bad = await tr.listBlobs('refs/heads/nope', ['docs/']);
    expect(bad.value).toEqual([]);
    expect(bad.error).not.toBe('');
    // The reader stays usable.
    expect((await tr.listBlobs('refs/heads/main', ['docs/'])).value.map((f) => f.path)).toEqual(['docs/a.md']);
  }, T);

  it('reads SHA-256 repositories', async () => {
    const dir = makeTempDir('sha256');
    cleanups.push({ cleanup: () => removeTree(dir) });
    const git = async (args: string[]) => {
      const g = await runGit(dir, args);
      expect(g.code, `git ${args.join(' ')}: ${g.err}`).toBe(0);
      return g.out.trim();
    };
    await git(['init', '-q', '--object-format=sha256']);
    expect(await git(['rev-parse', '--show-object-format'])).toBe('sha256');
    for (const [k, v] of [['user.name', 'T'], ['user.email', 't@example.com'], ['commit.gpgsign', 'false']]) await git(['config', k, v]);
    fs.mkdirSync(`${dir}/specs/001-a`, { recursive: true });
    fs.writeFileSync(`${dir}/specs/001-a/tasks.md`, 't');
    fs.writeFileSync(`${dir}/specs/b.md`, 'b');
    await git(['add', '-A']);
    await git(['commit', '-q', '-m', 'init']);
    const reader = new BlobReader(dir);
    readers.push(reader);
    const got = await new TreeReader(reader).listBlobs('HEAD', ['specs/']);
    expect(got.error).toBe('');
    expect(got.value).toEqual((await listTreeBlobs(dir, 'HEAD', ['specs/'])).value);
    expect(got.value.map((f) => f.path)).toEqual(['specs/001-a/tasks.md', 'specs/b.md']);
    expect(got.value[0].oid).toHaveLength(64);
  }, T);

  it('a closed reader reports its error', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/a.md': 'a' });
    const reader = open(r);
    await reader.close();
    const l = await new TreeReader(reader).listBlobs('refs/heads/main', ['docs/']);
    expect(l.value).toEqual([]);
    expect(l.error).toBe('git cat-file: closed');
  }, T);
});
