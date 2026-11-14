// The commit-msg hook and its installer, exercised with real git in throwaway repositories (R1: pure Node).
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TestRepo } from '../../core/test/helpers/testRepo';
import { TASK_PATHSPECS } from '@speclog/core';
import { hookSourcePath, hooksPathOf, installHook } from '../src/hook';

const repos: TestRepo[] = [];
async function newRepo(name: string): Promise<TestRepo> {
  const r = await TestRepo.create(name);
  repos.push(r);
  return r;
}
afterAll(() => { for (const r of repos) r.cleanup(); });

/** Stages a new file and commits it; returns git's result (stderr carries hook output). */
async function commitFile(r: TestRepo, rel: string, msg: string) {
  r.write(rel, `${Math.random()}\n`);
  await r.git(['add', '-A']);
  return r.git(['commit', '-q', '-m', msg]);
}

const hooksDir = (r: TestRepo) => path.join(r.dir, '.git', 'hooks');
const WARN = /Speclog: no Task: line/;

describe('commit-msg hook', () => {
  let r1: TestRepo;
  beforeAll(async () => {
    r1 = await newRepo('hook1');
    expect(await installHook(r1.dir)).toBe('installed');
  });

  it('is installed, without BOM and CR', () => {
    const bytes = fs.readFileSync(path.join(hooksDir(r1), 'commit-msg'));
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0] === 0xef && bytes[1] === 0xbb).toBe(false);
    expect(bytes.includes(13)).toBe(false);
    expect(bytes.toString('utf8').startsWith('#!/bin/sh\n')).toBe(true);
    const src = fs.readFileSync(hookSourcePath());
    expect(src.includes(13)).toBe(false);
    expect(src[0] === 0xef && src[1] === 0xbb).toBe(false);
  });

  it('a: code change without Task: warns, commit succeeds', async () => {
    const r = await commitFile(r1, 'src/a.cpp', 'Change code');
    expect(r.code).toBe(0);
    expect(r.err).toMatch(WARN);
  });

  it('b: Task: and Task-Progress: lines suppress the warning', async () => {
    let r = await commitFile(r1, 'src/b.cpp', 'Change code\n\nTask: S1');
    expect(r.code).toBe(0);
    expect(r.err).not.toMatch(/Speclog/);
    r = await commitFile(r1, 'src/b2.cpp', 'Change code\n\nTask-Progress: S1');
    expect(r.code).toBe(0);
    expect(r.err).not.toMatch(/Speclog/);
  });

  it('c: docs, backlog, .backlog, specs and backlog.config.yml only: no warning', async () => {
    for (const p of ['docs/x.md', 'backlog/tasks/t.md', '.backlog/t.md', 'specs/001/tasks.md', 'backlog.config.yml']) {
      const r = await commitFile(r1, p, 'Task files only');
      expect(r.code).toBe(0);
      expect(r.err, p).not.toMatch(/Speclog/);
    }
  });

  it('non-ASCII task paths are not mistaken for code', async () => {
    const r = await commitFile(r1, 'docs/görev ç.md', 'Docs');
    expect(r.err).not.toMatch(/Speclog/);
  });

  it('a folder merely starting like a task folder is code', async () => {
    const r = await commitFile(r1, 'docsx/a.md', 'Change');
    expect(r.err).toMatch(WARN);
  });

  it('mixed task files + code warns', async () => {
    r1.write('docs/y.md', 'y');
    r1.write('src/c.cpp', 'c');
    await r1.git(['add', '-A']);
    const r = await r1.git(['commit', '-q', '-m', 'Mixed']);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(WARN);
  });

  it.each(['  Task: S1', 'Task:S1', 'Task: ', 'task: S1'])('rule: warns for %j', async (bad) => {
    const r = await commitFile(r1, 'src/t.cpp', `Change code\n\n${bad}`);
    expect(r.code).toBe(0);
    expect(r.err).toMatch(WARN);
  });

  it('merge commits are exempt', async () => {
    await r1.branch('side');
    await r1.commit('Side\n\nTask: S9', { 'src/side.cpp': 's' });
    await r1.checkout('main');
    await r1.commit('Main\n\nTask: S8', { 'src/main.cpp': 'm' });
    const r = await r1.git(['merge', '--no-ff', 'side', '-m', 'Merge side']);
    expect(r.code).toBe(0);
    expect(r.err).not.toMatch(/Speclog/);
  });

  it('the hook takes only the message file; MERGE_HEAD alone exempts', async () => {
    const hook = path.join(hooksDir(r1), 'commit-msg');
    const msg = path.join(r1.dir, '.git', 'MSG_TEST');
    fs.writeFileSync(msg, 'Change code\n');
    r1.write('src/direct.cpp', 'd');
    await r1.git(['add', '-A']);
    const run = () => new Promise<{ code: number; err: string }>((resolve) => {
      const p = spawn('sh', [hook.split(path.sep).join('/'), msg.split(path.sep).join('/'), 'merge'], { cwd: r1.dir });
      let err = '';
      p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
      p.on('close', (code) => resolve({ code: code ?? -1, err }));
    });
    let o = await run();
    expect(o.err).toMatch(WARN);
    fs.writeFileSync(path.join(r1.dir, '.git', 'MERGE_HEAD'), `${await r1.head()}\n`);
    o = await run();
    expect(o.code).toBe(0);
    expect(o.err).not.toMatch(/Speclog/);
    fs.rmSync(path.join(r1.dir, '.git', 'MERGE_HEAD'));
    await r1.git(['reset', '-q']);
  });

  it('idempotent: reinstall changes nothing and creates no commit-msg.local', async () => {
    const before = fs.readFileSync(path.join(hooksDir(r1), 'commit-msg'), 'utf8');
    expect(await installHook(r1.dir)).toBe('already');
    expect(fs.existsSync(path.join(hooksDir(r1), 'commit-msg.local'))).toBe(false);
    expect(fs.readFileSync(path.join(hooksDir(r1), 'commit-msg'), 'utf8')).toBe(before);
  });
});

describe('chaining a foreign hook', () => {
  it('d/e: kept as commit-msg.local, runs first, exit code propagated', async () => {
    const r = await newRepo('hook2');
    const foreign = '#!/bin/sh\necho LOCALHOOK-RAN >&2\nexit 0\n';
    fs.mkdirSync(hooksDir(r), { recursive: true });
    fs.writeFileSync(path.join(hooksDir(r), 'commit-msg'), foreign);
    expect(await installHook(r.dir)).toBe('chained');
    const local = path.join(hooksDir(r), 'commit-msg.local');
    expect(fs.readFileSync(local, 'utf8')).toBe(foreign);
    const c = await commitFile(r, 'src/a.cpp', 'Change code');
    const iLocal = c.err.indexOf('LOCALHOOK-RAN');
    const iWarn = c.err.search(WARN);
    expect(c.code).toBe(0);
    expect(iLocal).toBeGreaterThanOrEqual(0);
    expect(iWarn).toBeGreaterThan(iLocal);
    // idempotent with .local present
    expect(await installHook(r.dir)).toBe('already');
    expect(fs.readFileSync(local, 'utf8')).toBe(foreign);

    // a failing chained hook blocks the commit
    fs.writeFileSync(local, '#!/bin/sh\necho REJECTED >&2\nexit 1\n');
    const f = await commitFile(r, 'src/z.cpp', 'Change code');
    expect(f.code).not.toBe(0);
    expect(f.err).toMatch(/REJECTED/);
  });

  it('a kept hook without a shebang is still chained (via sh)', async () => {
    const r = await newRepo('hook4');
    fs.mkdirSync(hooksDir(r), { recursive: true });
    fs.writeFileSync(path.join(hooksDir(r), 'commit-msg'), 'echo NOSHEBANG-RAN >&2\n');
    expect(await installHook(r.dir)).toBe('chained');
    const c = await commitFile(r, 'src/a.cpp', 'Change code');
    expect(c.code).toBe(0);
    expect(c.err).toMatch(/NOSHEBANG-RAN/);
    expect(c.err).toMatch(/Speclog: no Task/);
  });

  it('a foreign hook and an existing commit-msg.local together are refused', async () => {
    const r = await newRepo('hook8');
    fs.mkdirSync(hooksDir(r), { recursive: true });
    fs.writeFileSync(path.join(hooksDir(r), 'commit-msg'), '#!/bin/sh\nexit 0\n');
    fs.writeFileSync(path.join(hooksDir(r), 'commit-msg.local'), '#!/bin/sh\nexit 0\n');
    await expect(installHook(r.dir)).rejects.toThrow(/commit-msg\.local/);
  });

  it('a 0-byte hook is replaced, not kept as commit-msg.local', async () => {
    const r = await newRepo('hook7');
    fs.mkdirSync(hooksDir(r), { recursive: true });
    fs.writeFileSync(path.join(hooksDir(r), 'commit-msg'), Buffer.alloc(0));
    expect(await installHook(r.dir)).toBe('installed');
    expect(fs.existsSync(path.join(hooksDir(r), 'commit-msg.local'))).toBe(false);
    expect(fs.readFileSync(path.join(hooksDir(r), 'commit-msg'), 'utf8')).toMatch(/Speclog commit-msg hook/);
  });
});

describe('core.hooksPath', () => {
  it('is not installed over; reported as skipped', async () => {
    const r = await newRepo('hook3');
    await r.git(['config', 'core.hooksPath', 'custom-hooks']);
    expect(await installHook(r.dir)).toBe('skipped-hooksPath');
    expect(fs.existsSync(path.join(hooksDir(r), 'commit-msg'))).toBe(false);
    expect(await hooksPathOf(r.dir)).toBe('custom-hooks');
  });

  it('hooksPathOf is empty when unset', async () => {
    const r = await newRepo('hook5');
    expect(await hooksPathOf(r.dir)).toBe('');
  });
});

describe('hook exemptions', () => {
  it('match the task pathspecs the core exempts from the untagged-commit check', () => {
    const text = fs.readFileSync(hookSourcePath(), 'utf8');
    const m = /grep -Evq '([^']+)'/.exec(text);
    expect(m).not.toBeNull();
    const hookPattern = m![1];
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
    const dirs = TASK_PATHSPECS.filter((p) => p.endsWith('/')).map((p) => esc(p.slice(0, -1)));
    const files = TASK_PATHSPECS.filter((p) => !p.endsWith('/')).map((p) => `^${esc(p)}$`);
    expect(hookPattern).toBe([`^(${dirs.join('|')})/`, ...files].join('|'));

    const re = new RegExp(hookPattern);
    for (const p of TASK_PATHSPECS) expect(re.test(p.endsWith('/') ? `${p}x.md` : p), p).toBe(true);
    for (const p of ['src/a.ts', 'README.md', 'backlogs/x.md', 'specsx/a.md', 'backlog.config.yml.bak', 'x/docs/a.md']) {
      expect(re.test(p), p).toBe(false);
    }
  });
});
