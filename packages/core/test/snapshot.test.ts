// Port of ProjectManager tests/SnapshotTests.cpp (same case names) plus Speclog extras.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildSnapshot, keepLastGood, normalizeBranchDays, DEFAULT_BRANCH_DAYS, RepoSnapshot } from '../src/snapshot';
import type { Program, RepoInfo } from '../src/model';
import { TestRepo, TestRemote } from './helpers/testRepo';
import { resolveAll } from '../src/status';
import { buildTree, defaultFilter } from '../src/viewTree';
import { computeAttention } from '../src/attention';

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

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Local date today, YYYY-MM-DD. */
const today = () => ymd(new Date());
/** Local date n days before today. */
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86400000));

const info = (r: TestRepo): RepoInfo => ({ name: 'repo', owner: '', path: r.dir, origin: '', key: r.dir });

function item(id: string, extra = ''): string {
  return `## ${id} Title ${id}\nstatus: open\nsize: S\n${extra}\n`;
}
function file(items: string): string {
  return `# Prog\nprogram: P\narea: A\ncreated: 2026-01-01\n\n${items}`;
}
function backlogTask(n: number, status = 'To Do'): string {
  return `---\nid: task-${n}\ntitle: Item ${n}\nstatus: ${status}\nlabels: []\ndependencies: []\n---\n\nItem ${n}.\n`;
}
function specTasks(ids: string[]): string {
  return `# Tasks: X\n\n## Phase 1: Setup\n\n${ids.map((t) => `- [ ] ${t} Do ${t}`).join('\n')}\n`;
}

const hasIssueKind = (s: RepoSnapshot, kind: string) => s.issues.some((i) => i.kind === kind);
const itemIds = (ps: Program[]) => ps.flatMap((p) => p.items.map((i) => i.id));

/** Deletes a loose object, so git commands that need it fail. */
function dropObject(r: TestRepo, hash: string): void {
  const p = path.join(r.dir, '.git', 'objects', hash.slice(0, 2), hash.slice(2));
  fs.chmodSync(p, 0o666);
  fs.unlinkSync(p);
}

function snap(over: Partial<RepoSnapshot>): RepoSnapshot {
  return {
    repo: { name: '', owner: '', path: '', origin: '', key: '' },
    main: { name: '', tipRef: '', reachRefs: [] },
    formats: [], hasTaskFiles: false, programs: [], issues: [], mainCommits: [], branches: [], evidence: [],
    sinceCommit: '', hasSinceFile: false, programsAtSince: [], commitsAfterSince: new Set(),
    trustCommit: '', programsAtTrust: [], uncommittedTaskChanges: false, changedFiles: new Map(), error: '',
    ...over,
  };
}
const progs = (n: number) => Array.from({ length: n }, () => ({}) as Program);

describe('snapshot', () => {
  it('snapshot reads programs from main not worktree', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
    r.write('docs/tasks/a.md', file(item('A1') + item('A2')));
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.programs.length).toBe(1);
    expect(s.programs[0].items.length).toBe(1);
    expect(s.hasTaskFiles).toBe(true);
    expect(s.formats).toEqual(['docsTasks']);
    expect(s.error).toBe('');
  }, T);

  it('branch programs captured', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
    await r.branch('feature/x');
    await r.commit('add', { 'docs/tasks/a.md': file(item('A1') + item('N1')) });
    await r.checkout('main');
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.branches.length).toBe(1);
    expect(itemIds(s.branches[0].programs)).toContain('N1');
  }, T);

  describe('branch window', () => {
    /** main plus one branch whose only commit is `age` days old (noon, so the local date is stable). */
    async function aged(age: number): Promise<TestRepo> {
      const r = await repo();
      await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
      await r.branch('feature/old');
      await r.commit('add', { 'docs/tasks/a.md': file(item('A1') + item('N1')) }, `${daysAgo(age)}T12:00:00`);
      await r.checkout('main');
      return r;
    }
    it('ignores a 40-day-old branch at the default window', async () => {
      const r = await aged(40);
      const s = await buildSnapshot(info(r), { today: today() });
      expect(s.branches).toEqual([]);
    }, T);
    it('reads it with branchDays 0 (all) and 60', async () => {
      const r = await aged(40);
      for (const branchDays of [0, 60]) {
        const s = await buildSnapshot(info(r), { today: today(), branchDays });
        expect(s.branches.length).toBe(1);
        expect(itemIds(s.branches[0].programs)).toContain('N1');
      }
    }, T);
    it('keeps a tip exactly branchDays old and drops one day older', async () => {
      const r = await aged(30);
      expect((await buildSnapshot(info(r), { today: today() })).branches.length).toBe(1);
      const r2 = await aged(31);
      expect((await buildSnapshot(info(r2), { today: today() })).branches).toEqual([]);
    }, T);
    it('normalizes the setting: invalid values give the default', () => {
      expect(DEFAULT_BRANCH_DAYS).toBe(30);
      for (const v of [undefined, null, 'x', -1, 1.5, NaN, Infinity]) expect(normalizeBranchDays(v)).toBe(30);
      expect(normalizeBranchDays(0)).toBe(0);
      expect(normalizeBranchDays(60)).toBe(60);
    });
  });

  it('branch commits exclude main', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
    await r.branch('feature/x');
    await r.commit('one', { 'f1.txt': '1' });
    await r.commit('two', { 'f2.txt': '2' });
    await r.checkout('main');
    await r.commit('main more', { 'm.txt': 'm' });
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.branches.length).toBe(1);
    expect(s.branches[0].commits.length).toBe(2);
    expect(s.mainCommits.length).toBe(2);
  }, T);

  it('no tasks dir', async () => {
    const r = await repo();
    await r.commit('init', { 'README.md': 'x' });
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.hasTaskFiles).toBe(false);
    expect(s.formats).toEqual([]);
    expect(s.programs).toEqual([]);
    expect(s.error).toBe('');
  }, T);

  it('empty repo snapshot', async () => {
    const r = await repo();
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.main.name).toBe('');
    expect(s.error).toBe('');
    expect(s.programs).toEqual([]);
  }, T);

  it('evidence evaluated on main tip', async () => {
    const r = await repo();
    const ev = 'evidence: present "SolveTargetForce" in src/*.cpp';
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1', ev)), 'src/x.cpp': 'int a;' });
    await r.branch('feature/x');
    await r.commit('impl', { 'src/y.cpp': 'void SolveTargetForce();' });
    await r.checkout('main');
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.evidence).toEqual([{ id: 'A1', found: false, expectPresent: true }]);
  }, T);

  it('evidence absent and bad evidence', async () => {
    const r = await repo();
    await r.commit('init', {
      'docs/tasks/a.md': file(item('A1', 'evidence: absent "Foo" in src/*.cpp') + item('A2', 'evidence: whatever')),
      'src/x.cpp': 'Foo',
    });
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.evidence).toEqual([{ id: 'A1', found: true, expectPresent: false }]);
    expect(hasIssueKind(s, 'bad-evidence')).toBe(true);
  }, T);

  it('since commit and programs at since', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
    const first = await r.head();
    await r.commit('more', { 'docs/tasks/a.md': file(item('A1') + item('A2')), 'docs/tasks/.since': `${first}\n` });
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.sinceCommit).toBe(first);
    expect(s.programsAtSince.length).toBe(1);
    expect(s.programsAtSince[0].items.length).toBe(1);
    expect(s.programs[0].items.length).toBe(2);
  }, T);

  it('changed files only for recent main commits', async () => {
    const r = await repo();
    await r.commit('old', { 'old.txt': 'o' }, '2020-01-01T12:00:00');
    const oldH = await r.head();
    await r.commit('new', { 'new.txt': 'n' });
    const newH = await r.head();
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.changedFiles.has(oldH)).toBe(false);
    expect(s.changedFiles.get(newH)).toEqual(['new.txt']);
  }, T);

  it("branch task files are skipped when docs/tasks equals main's", async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
    await r.branch('feature/same');
    await r.commit('code', { 'x.txt': 'x' });
    await r.checkout('main');
    await r.branch('feature/diff');
    await r.commit('tasks', { 'docs/tasks/a.md': file(item('A1') + item('N1')) });
    await r.checkout('main');
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.branches.length).toBe(2);
    for (const b of s.branches) {
      expect(b.commits.length).toBe(1);
      expect(b.programs.length).toBe(b.tip.name === 'feature/same' ? 0 : 1);
    }
  }, T);

  it('merged branch contributes nothing', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
    await r.branch('feature/x');
    await r.commit('x', { 'docs/tasks/a.md': file(item('A1') + item('X1')) });
    await r.checkout('main');
    await r.merge('feature/x');
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.branches).toEqual([]);
  }, T);

  it('changed files include merged side commits in the window', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    await r.branch('feature/x');
    await r.commit('f', { 'f.txt': 'f' });
    const side = await r.head();
    await r.checkout('main');
    await r.commit('m', { 'm.txt': 'm' });
    await r.merge('feature/x');
    const merge = await r.head();
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.changedFiles.size).toBe(s.mainCommits.length);
    expect(s.changedFiles.get(side)).toEqual(['f.txt']);
    expect(s.changedFiles.get(merge)).toEqual(['f.txt']);
  }, T);

  it('cancelled build returns early', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
    const ac = new AbortController();
    ac.abort();
    const s = await buildSnapshot(info(r), { today: today(), recentDays: 30, signal: ac.signal });
    expect(s.error).toBe('cancelled');
    expect(s.programs).toEqual([]);
    const ok = await buildSnapshot(info(r), { today: today(), recentDays: 30, signal: new AbortController().signal });
    expect(ok.error).toBe('');
    expect(ok.programs.length).toBe(1);
  }, T);

  it('stacked branches each get their own reachable commits', async () => {
    const r = await repo();
    await r.commit('init', { 'a.txt': 'a' });
    await r.branch('feature/a');
    await r.commit('a1', { 'a1.txt': '1' });
    const a1 = await r.head();
    await r.branch('feature/b');
    await r.commit('b1', { 'b1.txt': '1' });
    const b1 = await r.head();
    await r.checkout('main');
    await r.commit('m', { 'm.txt': 'm' });
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.branches.length).toBe(2);
    for (const b of s.branches) {
      if (b.tip.name === 'feature/a') expect(b.commits.map((c) => c.hash)).toEqual([a1]);
      else expect(b.commits.map((c) => c.hash)).toEqual([b1, a1]); // newest first
    }
  }, T);

  it('a failing git log sets the snapshot error', async () => {
    const r = await repo();
    await r.commit('first', { 'a.txt': 'a' });
    const first = await r.head();
    await r.commit('tasks', { 'docs/tasks/a.md': file(item('A1')) });
    dropObject(r, first);
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.error).not.toBe('');
    expect(s.error).toContain('git log');
  }, T);

  it('an unreadable task file sets the snapshot error', async () => {
    const r = await repo();
    await r.commit('tasks', { 'docs/tasks/a.md': file(item('A1')) });
    const blob = (await r.git(['rev-parse', 'HEAD:docs/tasks/a.md'])).out.trim();
    dropObject(r, blob);
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.error).toContain('docs/tasks/a.md');
  }, T);

  it('keep last good snapshot when a rebuild fails', () => {
    const good = snap({ repo: { name: 'R', owner: '', path: '', origin: '', key: '' }, programs: progs(2) });
    const failed = snap({ repo: { name: 'R', owner: '', path: '', origin: '', key: '' }, error: 'git log: fatal' });
    const shown = keepLastGood(good, failed);
    expect(shown.programs.length).toBe(2); // old data stays on screen
    expect(shown.error).toBe('git log: fatal'); // and the failure is reported
    expect(good.error).toBe(''); // the previous snapshot itself is not changed

    const again = keepLastGood(shown, failed); // fails twice: still the data
    expect(again.programs.length).toBe(2);

    const partial = snap({
      ...failed, programs: progs(3), hasTaskFiles: true, formats: ['docsTasks'], mainCommits: [{} as never],
      issues: [{ path: 'docs/tasks/a.md', line: 1, kind: 'syntax', detail: 'x' }],
    });
    const first = keepLastGood(undefined, partial); // nothing earlier: error only, partial data dropped
    expect(first.error).toBe('git log: fatal');
    expect(first.repo.name).toBe('R');
    expect(first.programs).toEqual([]);
    expect(first.mainCommits).toEqual([]);
    expect(first.issues).toEqual([]);
    expect(first.hasTaskFiles).toBe(false);
    expect(first.formats).toEqual([]);

    const ok = snap({ programs: progs(1) });
    expect(keepLastGood(good, ok).programs.length).toBe(1);
    expect(keepLastGood(good, ok).error).toBe('');
  });

  it('.since: CRLF, BOM and an abbreviated hash resolve to the full commit', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
    const first = await r.head();
    await r.commit('more', {
      'docs/tasks/a.md': file(item('A1') + item('A2')),
      'docs/tasks/.since': `﻿${first.slice(0, 12)}\r\nsecond line\r\n`,
    });
    await r.commit('code', { 'src/x.cpp': 'x' });
    const code = await r.head();
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.error).toBe('');
    expect(s.hasSinceFile).toBe(true);
    expect(s.sinceCommit).toBe(first);
    expect(hasIssueKind(s, 'bad-since')).toBe(false);
    expect(s.commitsAfterSince.size).toBe(2);
    expect(s.commitsAfterSince.has(code)).toBe(true);
    expect(s.commitsAfterSince.has(first)).toBe(false);
  }, T);

  it('.since: invalid values are format issues', async () => {
    const run = async (since: string) => {
      const r = await repo();
      await r.commit('init', { 'docs/tasks/a.md': file(item('A1')) });
      await r.branch('side');
      await r.commit('side', { 's.txt': 's' });
      const side = await r.head();
      await r.checkout('main');
      await r.commit('since', { 'docs/tasks/.since': since === 'side' ? `${side}\n` : since });
      return buildSnapshot(info(r), { today: today() });
    };
    for (const v of ['', 'not a hash', '--all', '0000000000000000000000000000000000000000', 'side']) {
      const s = await run(v);
      expect(s.error).toBe('');
      expect(s.hasSinceFile).toBe(true);
      expect(s.sinceCommit).toBe('');
      expect(hasIssueKind(s, 'bad-since')).toBe(true);
      expect(s.commitsAfterSince.size).toBe(0);
    }
  }, T);

  it('tasks dir with no .md files still counts as present', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/.since': 'x\n' });
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.hasTaskFiles).toBe(true);
    expect(s.formats).toEqual(['docsTasks']);
    expect(s.programs).toEqual([]);
  }, T);

  it('evidence text may contain quotes', async () => {
    const r = await repo();
    const ev = 'evidence: present "say "hi" now" in src/*.cpp';
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1', ev)), 'src/x.cpp': '// say "hi" now\n' });
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.evidence.length).toBe(1);
    expect(s.evidence[0].found).toBe(true);
    expect(hasIssueKind(s, 'bad-evidence')).toBe(false);
  }, T);

  it('changed files: the recentDays boundary is inclusive', async () => {
    const r = await repo();
    await r.commit('edge', { 'a.txt': 'a' }, `${daysAgo(10)}T12:00:00`);
    const edge = await r.head();
    await r.commit('outside', { 'b.txt': 'b' }, `${daysAgo(11)}T12:00:00`); // committer date order does not matter
    const outside = await r.head();
    const s = await buildSnapshot(info(r), { today: today(), recentDays: 10 });
    expect(s.changedFiles.has(edge)).toBe(true);
    expect(s.changedFiles.has(outside)).toBe(false);
  }, T);

  it('snapshot reads origin/main when origin/HEAD is missing', async () => {
    const t = await TestRemote.create();
    cleanups.push(t);
    await t.work.git(['remote', 'set-head', 'origin', '-d']);
    await t.work.commit('tasks', { 'docs/tasks/a.md': file(item('A1')) });
    await t.work.git(['push', '-q', 'origin', 'main']);
    await t.work.git(['reset', '-q', '--hard', 'HEAD~1']); // local main behind origin
    const s = await buildSnapshot(info(t.work), { today: today() });
    expect(s.error).toBe('');
    expect(s.main.name).toBe('origin/main');
    expect(s.programs.length).toBe(1); // read from origin's tip
    expect(s.mainCommits.length).toBe(2);
  }, T);

  it('a first build that fails shows only the git error', async () => {
    const r = await repo();
    await r.commit('first', { 'a.txt': 'a' });
    const first = await r.head();
    await r.commit('tasks', { 'docs/tasks/a.md': file(item('A1')) });
    dropObject(r, first); // log fails, task files still read
    const built = await buildSnapshot(info(r), { today: today() });
    expect(built.error).not.toBe('');
    expect(built.programs.length).toBeGreaterThan(0); // the raw build is partial
    const shown = keepLastGood(undefined, built);
    expect(shown.error).toBe(built.error);
    expect(shown.programs).toEqual([]);
    expect(shown.mainCommits).toEqual([]);
    expect(shown.branches).toEqual([]);
    expect(shown.hasTaskFiles).toBe(false);
    // End to end: the tree shows the git error, the attention list has one gitError row.
    const ws = resolveAll([shown], 'unverified');
    const tree = buildTree(ws, 'program', defaultFilter());
    expect(tree.children.length).toBe(1);
    expect(tree.children[0].children.map((c) => [c.label, c.placeholder])).toEqual([['Git error', true]]);
    const cfg = { today: today(), staleBranchDays: 7, recentDays: 30, fetchFailSeconds: 3600 };
    const att = computeAttention(ws, cfg, [], 0);
    expect(att.filter((a) => a.kind === 'gitError').length).toBe(1);
  }, T);

  // --- Speclog extras ---

  it('backlog files read from main, not worktree', async () => {
    const r = await repo();
    await r.commit('init', { 'backlog/tasks/task-1 - Item-1.md': backlogTask(1) });
    r.write('backlog/tasks/task-2 - Item-2.md', backlogTask(2));
    r.write('backlog/tasks/task-1 - Item-1.md', backlogTask(1, 'Done'));
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.error).toBe('');
    expect(s.formats).toEqual(['backlogMd']);
    expect(s.hasTaskFiles).toBe(true);
    expect(itemIds(s.programs)).toEqual(['task-1']);
    expect(s.programs[0].items[0].fileDone).toBe(false);
    expect(s.uncommittedTaskChanges).toBe(true);
  }, T);

  it('trust commit reads programs at that commit', async () => {
    const r = await repo();
    await r.commit('init', { 'backlog/tasks/task-1 - Item-1.md': backlogTask(1), 'docs/tasks/a.md': file(item('A1')) });
    const first = await r.head();
    await r.commit('more', { 'backlog/tasks/task-2 - Item-2.md': backlogTask(2) });
    const second = await r.head();
    const s = await buildSnapshot(info(r), { today: today(), trustCommit: first.slice(0, 10) });
    expect(s.error).toBe('');
    expect(s.trustCommit).toBe(first);
    expect(s.programsAtTrust.map((p) => p.format)).toEqual(['backlogMd']); // docs/tasks uses .since
    expect(itemIds(s.programsAtTrust)).toEqual(['task-1']);
    expect([...s.commitsAfterSince]).toEqual([second]);
    expect(hasIssueKind(s, 'bad-trust')).toBe(false);

    // A cutoff that is no commit or not on main is ignored with a format issue, not an error.
    await r.branch('side');
    await r.commit('side', { 's.txt': 's' });
    const side = await r.head();
    await r.checkout('main');
    for (const bad of ['not a hash', '0000000000000000000000000000000000000000', side]) {
      const b = await buildSnapshot(info(r), { today: today(), trustCommit: bad });
      expect(b.error).toBe('');
      expect(b.trustCommit).toBe('');
      expect(b.programsAtTrust).toEqual([]);
      expect(b.commitsAfterSince.size).toBe(0);
      expect(b.issues.filter((i) => i.kind === 'bad-trust').map((i) => [i.path, i.line])).toEqual([['', 0]]);
    }
  }, T);

  it('trust commit and .since: commits after either cutoff', async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')), 'backlog/tasks/task-1 - Item-1.md': backlogTask(1) });
    const first = await r.head();
    await r.commit('since', { 'docs/tasks/.since': `${first}\n` });
    const second = await r.head();
    await r.commit('code', { 'x.txt': 'x' });
    const third = await r.head();
    const s = await buildSnapshot(info(r), { today: today(), trustCommit: third });
    expect(s.sinceCommit).toBe(first);
    expect(s.trustCommit).toBe(third);
    expect([...s.commitsAfterSince].sort()).toEqual([second, third].sort());
  }, T);

  it('uncommitted backlog edit sets uncommittedTaskChanges', async () => {
    const r = await repo();
    await r.commit('init', { 'backlog/tasks/task-1 - Item-1.md': backlogTask(1), 'src/x.txt': 'x' });
    expect((await buildSnapshot(info(r), { today: today() })).uncommittedTaskChanges).toBe(false);
    r.write('src/x.txt', 'changed'); // not a task file
    expect((await buildSnapshot(info(r), { today: today() })).uncommittedTaskChanges).toBe(false);
    r.write('backlog/tasks/task-1 - Item-1.md', backlogTask(1, 'In Progress'));
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.uncommittedTaskChanges).toBe(true);
    expect(s.error).toBe('');
  }, T);

  it('only Spec Kit tasks.md / spec.md edits under specs/ set uncommittedTaskChanges', async () => {
    const r = await repo();
    await r.commit('init', { 'specs/001-a/tasks.md': '# Tasks\n\n- [ ] T001 One\n', 'specs/001-a/plan.md': 'plan\n' });
    r.write('specs/001-a/plan.md', 'changed plan\n'); // Spec Kit does not read it
    r.write('specs/001-a/research.md', 'new\n');
    r.write('specs/notes.md', 'new\n');
    r.write('specs/001-a/deep/tasks.md', 'not a feature folder\n');
    expect((await buildSnapshot(info(r), { today: today() })).uncommittedTaskChanges).toBe(false);
    r.write('specs/002-b/spec.md', '# Spec\n');
    expect((await buildSnapshot(info(r), { today: today() })).uncommittedTaskChanges).toBe(true);
  }, T);

  it('repo with backlog and docs/tasks reads both formats', async () => {
    const r = await repo();
    await r.commit('init', {
      'docs/tasks/a.md': file(item('A1')),
      'backlog/tasks/task-1 - Item-1.md': backlogTask(1),
      'backlog/config.yml': 'project_name: "X"\nstatuses: ["To Do", "Doing", "Done"]\n',
    });
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.error).toBe('');
    expect(s.formats).toEqual(['docsTasks', 'backlogMd']);
    expect(s.programs.map((p) => p.format)).toEqual(['docsTasks', 'backlogMd']);
    expect(itemIds(s.programs)).toEqual(['A1', 'task-1']);
  }, T);

  it('spec kit files read from the main tip and from branches whose specs differ', async () => {
    const r = await repo();
    await r.commit('init', { 'specs/001-x/tasks.md': specTasks(['T001']), 'docs/tasks/a.md': file(item('A1')) });
    await r.branch('feature/spec');
    await r.commit('spec', { 'specs/001-x/tasks.md': specTasks(['T001', 'T002']) });
    await r.checkout('main');
    await r.branch('feature/code');
    await r.commit('code', { 'x.txt': 'x' });
    await r.checkout('main');
    const s = await buildSnapshot(info(r), { today: today() });
    expect(s.error).toBe('');
    expect(s.formats).toEqual(['docsTasks', 'specKit']);
    expect(itemIds(s.programs)).toEqual(['A1', '001-x/T001']);
    const byName = new Map(s.branches.map((b) => [b.tip.name, b]));
    expect(byName.get('feature/code')!.programs).toEqual([]);
    // Only the changed format is read on the branch: unchanged files add no branch-only items.
    expect(itemIds(byName.get('feature/spec')!.programs)).toEqual(['001-x/T001', '001-x/T002']);
  }, T);

  it("cancelled build returns error 'cancelled' and is not usable", async () => {
    const r = await repo();
    await r.commit('init', { 'docs/tasks/a.md': file(item('A1')), 'backlog/tasks/task-1 - Item-1.md': backlogTask(1) });
    await r.branch('feature/x');
    await r.commit('x', { 'docs/tasks/a.md': file(item('A1') + item('X1')) });
    await r.checkout('main');
    // Aborted while the first git call runs: the git failure it causes is not the reported error.
    const ac = new AbortController();
    const started = Date.now();
    const p = buildSnapshot(info(r), { today: today(), signal: ac.signal });
    ac.abort();
    const s = await p;
    expect(s.error).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(10000);
    const shown = keepLastGood(undefined, s);
    expect(shown.error).toBe('cancelled');
    expect(shown.programs).toEqual([]);
    expect(shown.hasTaskFiles).toBe(false);
    // Aborted at any later point: still "cancelled", never a git error.
    for (const delay of [5, 20, 60, 150]) {
      const c = new AbortController();
      const q = buildSnapshot(info(r), { today: today(), signal: c.signal });
      setTimeout(() => c.abort(), delay);
      const res = await q;
      expect(['cancelled', '']).toContain(res.error); // '' only when the build finished first
    }
  }, T);
});
