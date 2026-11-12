// Port of ProjectManager tests/GitRepoTests.cpp (same case names) plus Speclog extras.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runGit } from '../src/git/runner';
import {
  BranchTip, MainRef, isHexHash, resolveMain, listOtherBranches, logCommits, revList, listFiles,
  readBlob, grepFixed, resolveCommit, changedFiles, changedFilesSince, objectIds, fetch, fetchArgs,
  fetchOptions, FETCH_SSH_COMMAND, userSshConfigured, hasUncommittedChanges, listTree,
} from '../src/git/repo';
import { TestRepo, TestRemote, TEST_BASE } from './helpers/testRepo';

const T = 60000;
const cleanups: Array<{ cleanup(): void }> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!.cleanup();
});
async function repo(name?: string, defaultBranch?: string): Promise<TestRepo> {
  const r = await TestRepo.create(name, defaultBranch);
  cleanups.push(r);
  return r;
}
async function remote(name?: string): Promise<TestRemote> {
  const r = await TestRemote.create(name);
  cleanups.push(r);
  return r;
}
const hasBranch = (v: BranchTip[], n: string) => v.some((b) => b.name === n);

describe('git repo queries', () => {
  it('test repos live under a path with spaces and non-ASCII characters', async () => {
    const r = await repo();
    expect(r.dir).toContain('Proje Ç ğ');
    expect(TEST_BASE).toContain(' ');
  }, T);

  it('resolve main on empty repo', async () => {
    const r = await repo();
    const m = await resolveMain(r.dir);
    expect(m.error).toBe('');
    expect(m.value.name).toBe('');
    expect(m.value.reachRefs).toEqual([]);
    expect((await listOtherBranches(r.dir, m.value)).value).toEqual([]);
    expect((await logCommits(r.dir, [], [])).value).toEqual([]);
    expect((await logCommits(r.dir, ['main'], [])).value).toEqual([]);
    expect((await listFiles(r.dir, 'main', 'docs/tasks')).value).toEqual([]);
    expect((await readBlob(r.dir, 'main', 'a.md')).value).toBeNull();
    expect(await grepFixed(r.dir, 'main', 'x', '')).not.toBe('found');
    expect((await changedFiles(r.dir, '0'.repeat(40))).value).toEqual([]);
  }, T);

  it('resolve main without origin head', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    const m = (await resolveMain(r.dir)).value;
    expect(m.name).toBe('main');
    expect(m.tipRef).toBe('refs/heads/main');
    expect(m.reachRefs).toEqual(['refs/heads/main']);

    const old = await repo('old', 'master');
    await old.commit('init', { 'a.txt': 'a' });
    const mo = (await resolveMain(old.dir)).value;
    expect(mo.name).toBe('master');
    expect(mo.tipRef).toBe('refs/heads/master');
  }, T);

  it('resolve main prefers local tip when ahead', async () => {
    const t = await remote();
    const m = (await resolveMain(t.work.dir)).value;
    expect(m.name).toBe('origin/main');
    expect(m.tipRef).toBe('refs/remotes/origin/main');
    expect(m.reachRefs).toEqual(['refs/remotes/origin/main', 'refs/heads/main']);

    await t.work.commit('local only', { 'b.txt': 'b' });
    const a = (await resolveMain(t.work.dir)).value;
    expect(a.name).toBe('origin/main');
    expect(a.tipRef).toBe('refs/heads/main');
  }, T);

  it('lists other branches', async () => {
    const t = await remote();
    await t.pushRemoteOnlyBranch('feature/y', 'y.txt');
    await t.work.branch('feature/x');
    await t.work.commit('x', { 'x.txt': 'x' });
    await t.work.checkout('main');

    const m = (await resolveMain(t.work.dir)).value;
    const br = (await listOtherBranches(t.work.dir, m)).value;
    expect(br.length).toBe(2);
    expect(hasBranch(br, 'feature/x')).toBe(true);
    expect(hasBranch(br, 'origin/feature/y')).toBe(true);
    expect(hasBranch(br, 'main')).toBe(false);
    expect(hasBranch(br, 'origin/main')).toBe(false);
    expect(hasBranch(br, 'origin/HEAD')).toBe(false);
    for (const b of br) {
      expect(b.hash.length).toBe(40);
      expect(b.date.length).toBe(10);
    }
  }, T);

  it('log commits parses refs and dates', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    await r.branch('feature/x');
    await r.commit('work\n\nTask: S1\nTask-Progress: Other:P2', { 'b.txt': 'b' }, '2026-03-04T10:00:00');
    await r.checkout('main');
    await r.commit('main work', { 'c.txt': 'c' });
    await r.merge('feature/x');

    const log = (await logCommits(r.dir, ['main'], [])).value;
    expect(log.length).toBe(4);
    expect(log[0].parents.length).toBe(2);
    const w = log.find((c) => c.subject === 'work');
    expect(w).toBeDefined();
    expect(w!.refs.done.length).toBe(1);
    expect(w!.refs.done[0].id).toBe('S1');
    expect(w!.refs.progress.length).toBe(1);
    expect(w!.refs.progress[0].repo).toBe('Other');
    expect(w!.date).toBe('2026-03-04');
    expect(w!.hash.length).toBe(40);
    for (const c of log) {
      expect(c.date.length).toBe(10);
      expect(c.date[4]).toBe('-');
      expect(c.date[7]).toBe('-');
    }
  }, T);

  it('log with exclude gives branch-only commits', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    await r.branch('feature/x');
    await r.commit('f1', { 'b.txt': 'b' });
    await r.commit('f2', { 'c.txt': 'c' });
    await r.checkout('main');
    await r.commit('m1', { 'd.txt': 'd' });

    const only = (await logCommits(r.dir, ['feature/x'], ['main'])).value;
    expect(only.length).toBe(2);
    expect(only[0].subject).toBe('f2');
    expect(only[1].subject).toBe('f1');

    // since filter: everything is older than the future date
    expect((await logCommits(r.dir, ['main'], [], '2099-01-01')).value).toEqual([]);
    expect((await logCommits(r.dir, ['main'], [], '2000-01-01')).value.length).toBe(2);
  }, T);

  it('list files and read blob from ref', async () => {
    const r = await repo();
    await r.commit('tasks', { 'docs/tasks/a.md': 'committed\r\nline\n', 'docs/tasks/b.md': 'b', 'docs/other.md': 'o' });
    fs.rmSync(path.join(r.dir, 'docs/tasks/a.md'));
    r.write('docs/tasks/b.md', 'changed');

    const files = (await listFiles(r.dir, 'main', 'docs/tasks')).value;
    expect(files).toEqual(['docs/tasks/a.md', 'docs/tasks/b.md']);
    expect((await listFiles(r.dir, 'main', 'docs/tasks/')).value.length).toBe(2);
    expect((await listFiles(r.dir, 'main', 'nope')).value).toEqual([]);

    expect((await readBlob(r.dir, 'main', 'docs/tasks/a.md')).value).toBe('committed\r\nline\n'); // raw, CRLF kept
    expect((await readBlob(r.dir, 'main', 'docs/tasks/b.md')).value).toBe('b');
    const missing = await readBlob(r.dir, 'main', 'missing.md');
    expect(missing.value).toBeNull();
    expect(missing.error).toBe(''); // a missing blob is not an error
  }, T);

  it('grep fixed finds text in ref only', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/a.md': 'nothing\n' });
    await r.branch('feature/x');
    await r.commit('add', { 'docs/b.md': 'Yük hesabı (a.b) [x]\n' });
    await r.checkout('main');

    expect(await grepFixed(r.dir, 'main', 'Yük', 'docs')).toBe('absent');
    expect(await grepFixed(r.dir, 'feature/x', 'Yük', 'docs')).toBe('found');
    expect(await grepFixed(r.dir, 'feature/x', '(a.b) [x]', '')).toBe('found'); // fixed string, not regex
    expect(await grepFixed(r.dir, 'feature/x', 'Yük', 'src')).toBe('absent');
  }, T);

  it('changed files of a commit', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a', 'dir/b.txt': 'b' });
    const first = (await changedFiles(r.dir, await r.head())).value;
    expect(first.length).toBe(2);
    await r.branch('feature/x');
    await r.commit('f', { 'f.txt': 'f' });
    await r.checkout('main');
    await r.commit('m', { 'm.txt': 'm' });
    await r.merge('feature/x');
    const merge = (await changedFiles(r.dir, await r.head())).value;
    expect(merge).toEqual(['f.txt']); // relative to first parent
  }, T);

  it('fetch failure is reported', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    await r.git(['remote', 'add', 'origin', 'C:/no/such/remote/repo.git']);
    const f = await fetch(r.dir);
    expect(f.value.code).not.toBe(0);
    expect(f.error.startsWith('git fetch: ')).toBe(true);
  }, T);

  it('merged branches are not listed', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    await r.branch('feature/done');
    await r.commit('d', { 'd.txt': 'd' });
    await r.checkout('main');
    await r.merge('feature/done');
    await r.branch('feature/open');
    await r.commit('o', { 'o.txt': 'o' });
    await r.checkout('main');
    const br = (await listOtherBranches(r.dir, (await resolveMain(r.dir)).value)).value;
    expect(br.length).toBe(1);
    expect(hasBranch(br, 'feature/open')).toBe(true);
    expect(hasBranch(br, 'feature/done')).toBe(false);
  }, T);

  it('changed files since: one log, first-parent diffs, side commits included', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a', 'dir/b.txt': 'b' });
    const root = await r.head();
    await r.branch('feature/x');
    await r.commit('f', { 'f.txt': 'f' });
    const side = await r.head();
    await r.checkout('main');
    await r.commit('m', { 'm.txt': 'm' });
    const m = await r.head();
    await r.merge('feature/x');
    const merge = await r.head();
    const all = (await changedFilesSince(r.dir, ['main'], '')).value;
    expect(all.size).toBe(4);
    expect(all.get(root)!.length).toBe(2); // root commit lists every file
    expect(all.get(side)).toEqual(['f.txt']);
    expect(all.get(m)).toEqual(['m.txt']);
    expect(all.get(merge)).toEqual(['f.txt']); // relative to first parent
    for (const [h, f] of all) expect(f).toEqual((await changedFiles(r.dir, h)).value); // same answer as per commit
  }, T);

  it('changed files since: cut-off and empty commits', async () => {
    const r = await repo();
    await r.commit('old', { 'old.txt': 'o' }, '2020-01-01T12:00:00');
    const oldH = await r.head();
    await r.commit('new', { 'new.txt': 'n' });
    const newH = await r.head();
    await r.git(['commit', '-q', '--allow-empty', '-m', 'empty']);
    const emptyH = await r.head();
    const recent = (await changedFilesSince(r.dir, ['main'], '2021-01-01')).value;
    expect(recent.has(oldH)).toBe(false);
    expect(recent.get(newH)).toEqual(['new.txt']);
    expect(recent.has(emptyH)).toBe(true);
    expect(recent.get(emptyH)).toEqual([]);
    expect((await changedFilesSince(r.dir, [], '')).value.size).toBe(0);
  }, T);

  it('object ids in one call', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': 'x' });
    await r.branch('feature/x');
    await r.commit('b', { 'docs/tasks/a.md': 'y' });
    await r.checkout('main');
    const ids = (await objectIds(r.dir, ['main:docs/tasks', 'feature/x:docs/tasks', 'main:nope', 'nobranch:docs'])).value;
    expect(ids.length).toBe(4);
    expect(ids[0].length).toBe(40);
    expect(ids[1].length).toBe(40);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[2]).toBe('');
    expect(ids[3]).toBe('');
    const t = await r.git(['rev-parse', 'main:docs/tasks']);
    expect(t.out.slice(0, 40)).toBe(ids[0]);
  }, T);

  it('resolve main without origin/HEAD still uses origin/<default>', async () => {
    const t = await remote();
    await t.work.git(['remote', 'set-head', 'origin', '-d']);
    let r = await resolveMain(t.work.dir);
    expect(r.error).toBe('');
    let m: MainRef = r.value;
    expect(m.name).toBe('origin/main');
    expect(m.tipRef).toBe('refs/remotes/origin/main');
    expect(m.reachRefs).toEqual(['refs/remotes/origin/main', 'refs/heads/main']);

    // Local tip ahead: read files from it; origin stays a reach ref.
    await t.work.commit('local only', { 'b.txt': 'b' });
    m = (await resolveMain(t.work.dir)).value;
    expect(m.tipRef).toBe('refs/heads/main');
    expect(m.reachRefs.length).toBe(2);

    // Local tip behind (origin moved on): origin's tip is read.
    await t.work.git(['push', '-q', 'origin', 'main']);
    await t.work.git(['reset', '-q', '--hard', 'HEAD~1']);
    m = (await resolveMain(t.work.dir)).value;
    expect(m.tipRef).toBe('refs/remotes/origin/main');

    // Only origin/main (no local main): still the main branch.
    await t.work.git(['checkout', '-q', '--detach']);
    await t.work.git(['branch', '-q', '-D', 'main']);
    r = await resolveMain(t.work.dir);
    m = r.value;
    expect(m.name).toBe('origin/main');
    expect(m.reachRefs).toEqual(['refs/remotes/origin/main']);
    expect((await listOtherBranches(t.work.dir, m)).value).toEqual([]);
  }, T);

  it('full ref names: a branch named like an option or a path is read safely', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': 'x' });
    await r.git(['branch', 'origin/main']); // local branch that looks like a remote one
    await r.branch('feature/y');
    await r.commit('y', { 'y.txt': 'y' });
    await r.checkout('main');
    const m = (await resolveMain(r.dir)).value;
    expect(m.tipRef).toBe('refs/heads/main');
    const br = (await listOtherBranches(r.dir, m)).value;
    expect(br.length).toBe(1);
    expect(br[0].name).toBe('feature/y');
    expect(br[0].ref).toBe('refs/heads/feature/y');
    const log = await logCommits(r.dir, [br[0].ref], m.reachRefs, '', false);
    expect(log.value.length).toBe(1);
    expect(log.error).toBe('');
  }, T);

  it('readers report git failures instead of returning empty silently', async () => {
    const r = await repo();
    await r.commit('first', { 'a.txt': 'a' });
    const first = await r.head();
    await r.commit('second', { 'docs/tasks/a.md': 'x' });
    // Delete the loose object file of the first commit: history is now broken.
    fs.rmSync(path.join(r.dir, '.git', 'objects', first.slice(0, 2), first.slice(2)), { force: true });

    const log = await logCommits(r.dir, ['refs/heads/main'], [], '', false);
    expect(log.value).toEqual([]);
    expect(log.error.startsWith('git log')).toBe(true);

    const rl = await revList(r.dir, ['refs/heads/main'], []);
    expect(rl.value.size).toBe(0);
    expect(rl.error).not.toBe('');

    const lf = await listFiles(r.dir, 'refs/heads/nope', 'docs/tasks');
    expect(lf.value).toEqual([]);
    expect(lf.error).not.toBe('');

    const ob = await listOtherBranches(r.dir, { name: 'main', tipRef: 'refs/heads/nope', reachRefs: ['refs/heads/nope'] });
    expect(ob.value).toEqual([]);
    expect(ob.error).not.toBe('');

    expect(await grepFixed(r.dir, 'refs/heads/nope', 'x', '')).toBe('error');

    const cf = await changedFilesSince(r.dir, ['refs/heads/main'], '');
    expect(cf.value.size).toBe(0);
    expect(cf.error).not.toBe('');
    // "First failure wins" (PM's shared error pointer) does not apply: each call returns its own error.
  }, T);

  it('grep: not found is not an error', async () => {
    const r = await repo();
    await r.commit('init', { 'src/a.cpp': 'int a;' });
    expect(await grepFixed(r.dir, 'refs/heads/main', 'Missing', 'src')).toBe('absent');
    expect(await grepFixed(r.dir, 'refs/heads/main', 'int a', 'src')).toBe('found');
  }, T);

  it('list files returns blobs only', async () => {
    const r = await repo();
    await r.commit('tasks', { 'docs/tasks/a.md': 'a', 'docs/tasks/.since': 'x', 'docs/tasks/sub/b.md': 'b' });
    const files = await listFiles(r.dir, 'refs/heads/main', 'docs/tasks');
    expect(files.error).toBe('');
    expect(files.value).toEqual(['docs/tasks/.since', 'docs/tasks/a.md']);
    const none = await listFiles(r.dir, 'refs/heads/main', 'docs/none');
    expect(none.value).toEqual([]);
    expect(none.error).toBe(''); // a missing dir is not an error
  }, T);

  it('hex hash validation and commit resolution', async () => {
    expect(isHexHash('0123456789abcdef0123456789ABCDEF01234567')).toBe(true);
    expect(isHexHash('a'.repeat(64))).toBe(true);
    expect(isHexHash('0123456789abcdef0123456789abcdef0123456')).toBe(false);
    expect(isHexHash('0123456789abcdef0123456789abcdef0123456g')).toBe(false);
    expect(isHexHash('--output=x')).toBe(false);

    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    const h = await r.head();
    expect(await resolveCommit(r.dir, h.slice(0, 10))).toEqual({ value: h, error: '' });
    expect(await resolveCommit(r.dir, '0'.repeat(40))).toEqual({ value: '', error: '' });
    expect(await resolveCommit(r.dir, '--all')).toEqual({ value: '', error: '' });
  }, T);

  it('log reads many refs through stdin', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    // 300 refs x ~80 chars: past the 32 767-char command-line limit if passed as arguments.
    const refs: string[] = [];
    let create = '';
    const head = await r.head();
    for (let i = 0; i < 300; ++i) {
      const name = `refs/heads/feature/a-rather-long-branch-name-number-${i}`;
      create += `create ${name} ${head}\n`;
      refs.push(name);
    }
    expect((await runGit(r.dir, ['update-ref', '--stdin'], { stdin: create })).code).toBe(0);
    const log = await logCommits(r.dir, refs, [], '', true);
    expect(log.error).toBe('');
    expect(log.value.length).toBe(1);
    const rl = await revList(r.dir, refs, ['refs/heads/main']);
    expect(rl.value.size).toBe(0);
    expect(rl.error).toBe('');
  }, T);

  it('fetch never prompts and outlives the app', async () => {
    const args = fetchArgs();
    expect(args).toContain('credential.interactive=false');
    expect(args).toContain('http.lowSpeedLimit=1');
    expect(args).toContain('http.lowSpeedTime=60');
    expect(args.slice(-4)).toEqual(['fetch', '--quiet', '--prune', 'origin']);
    const o = fetchOptions(false);
    expect(o.timeoutMs).toBe(60000);
    expect(o.survivesCancel).toBe(true);
    expect(o.env).toEqual({ GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: FETCH_SSH_COMMAND });
    expect(FETCH_SSH_COMMAND).toBe('ssh -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4');
    const own = fetchOptions(true); // the user's ssh command is left alone
    expect(own.env).toEqual({ GCM_INTERACTIVE: 'never' });

    // The environment really reaches git's transport process (git strips -c config for a
    // local upload-pack, so the config is checked through fetchArgs above).
    const t = await remote();
    const dump = `${t.work.dir}/env.txt`;
    await t.work.git(['config', 'remote.origin.uploadpack', `env > '${dump}'; git-upload-pack`]);
    const f = await fetch(t.work.dir);
    expect(f.error).toBe('');
    expect(f.value.code).toBe(0);
    const env = fs.readFileSync(dump, 'utf8');
    expect(env).toContain('GCM_INTERACTIVE=never');
    expect(env).toContain('GIT_TERMINAL_PROMPT=0');

    // core.sshCommand set by the user wins over ours.
    const envSsh = !!process.env.GIT_SSH_COMMAND || !!process.env.GIT_SSH;
    if (!envSsh) {
      expect(await userSshConfigured(t.work.dir)).toBe(false);
      expect(env).toContain('GIT_SSH_COMMAND=ssh -o BatchMode=yes');
    }
    await t.work.git(['config', 'core.sshCommand', 'ssh -i mykey']);
    expect(await userSshConfigured(t.work.dir)).toBe(true);

    // Outlives: an abort only stops waiting; git completes the fetch and leaves no lock file.
    expect((await runGit(t.bare, ['update-ref', 'refs/heads/late', await t.work.head()])).code).toBe(0);
    await t.work.git(['config', 'remote.origin.uploadpack', 'sleep 4; git-upload-pack']);
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 300);
    const t0 = Date.now();
    const cancelled = await fetch(t.work.dir, ac.signal);
    expect(cancelled.value.cancelled).toBe(true);
    expect(cancelled.error).toBe('git fetch: cancelled');
    expect(Date.now() - t0).toBeLessThan(3000); // well before upload-pack starts (~4 s)
    const lateRef = async () => (await t.work.git(['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/late'])).code === 0;
    expect(await lateRef()).toBe(false); // not fetched yet when the wait was abandoned
    let landed = false;
    for (let i = 0; i < 75 && !landed; i++) {
      await new Promise((res) => setTimeout(res, 200));
      landed = await lateRef();
    }
    expect(landed).toBe(true);
    await new Promise((res) => setTimeout(res, 1000)); // let git exit
    const locks = (fs.readdirSync(path.join(t.work.dir, '.git'), { recursive: true }) as string[])
      .filter((f) => f.endsWith('.lock'));
    expect(locks).toEqual([]);
  }, T);

  it("list files: a root file named '--' and an empty dir argument", async () => {
    const r = await repo();
    await r.commit('init', { '--': 'x', 'a.txt': 'a', 'docs/tasks/b.md': 'b' });
    const root = await listFiles(r.dir, 'refs/heads/main', '');
    expect(root.error).toBe('');
    expect(root.value).toEqual(['--', 'a.txt']);
    expect((await listFiles(r.dir, 'refs/heads/main', 'docs/tasks')).value).toEqual(['docs/tasks/b.md']);
  }, T);

  // --- Speclog extras ---

  it('uncommitted change under backlog/ is detected', async () => {
    const r = await repo();
    const hasUncommitted = async (dir: string, specs: string[]) => {
      const u = await hasUncommittedChanges(dir, specs);
      expect(u.error).toBe('');
      return u.value;
    };
    await r.commit('init', { 'backlog/tasks/task-1 - A.md': 'a\n', 'src/x.txt': 'x' });
    expect(await hasUncommitted(r.dir, ['backlog', 'docs/tasks'])).toBe(false);
    r.write('src/x.txt', 'changed'); // outside the pathspecs
    expect(await hasUncommitted(r.dir, ['backlog', 'docs/tasks'])).toBe(false);
    r.write('backlog/tasks/task-1 - A.md', 'edited\n');
    expect(await hasUncommitted(r.dir, ['backlog', 'docs/tasks'])).toBe(true);
    await r.commit('edit');
    expect(await hasUncommitted(r.dir, ['backlog'])).toBe(false);
    r.write('backlog/tasks/task-2 - Yeni görev.md', 'new\n'); // untracked file counts too
    expect(await hasUncommitted(r.dir, ['backlog'])).toBe(true);
    // A git failure is reported, not taken as "clean".
    const bad = await hasUncommittedChanges(`${r.dir}/no such dir`, ['backlog']);
    expect(bad.value).toBe(false);
    expect(bad.error.startsWith('git status: ')).toBe(true);
  }, T);

  it('list tree reads blobs under several pathspecs recursively', async () => {
    const r = await repo();
    await r.commit('init', {
      'backlog/tasks/task-1 - Çay.md': 'a', 'backlog/config.yml': 'c', 'backlog.config.yml': 'r',
      'specs/001-x/tasks.md': 't', 'docs/tasks/a.md': 'd', 'docs/other.md': 'o', 'backlogx.txt': 'n',
    });
    const t = await listTree(r.dir, 'refs/heads/main', ['backlog/', 'backlog.config.yml', 'specs/', 'docs/tasks/', 'none/']);
    expect(t.error).toBe('');
    expect([...t.value].sort()).toEqual([
      'backlog.config.yml', 'backlog/config.yml', 'backlog/tasks/task-1 - Çay.md', 'docs/tasks/a.md', 'specs/001-x/tasks.md',
    ]);
    expect((await listTree(r.dir, 'refs/heads/main', [])).value).toEqual([]);
    const bad = await listTree(r.dir, 'refs/heads/nope', ['docs/tasks/']);
    expect(bad.error.startsWith('git ls-tree: ')).toBe(true);
  }, T);

  it('cancelled query reports cancelled', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    const ac = new AbortController();
    ac.abort();
    const m = await resolveMain(r.dir, ac.signal);
    expect(m.value.name).toBe('');
    expect(m.error).toBe('git symbolic-ref: cancelled');
    expect(await grepFixed(r.dir, 'refs/heads/main', 'a', '', ac.signal)).toBe('error');
  }, T);
});
