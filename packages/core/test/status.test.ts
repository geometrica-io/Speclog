// Port of ProjectManager tests/StatusEngineTests.cpp (same case names) plus Speclog extras.
import { describe, it, expect } from 'vitest';
import { findDependency, findItem, resolveAll, ResolvedItem, UnverifiedMode, Workspace } from '../src/status';
import type { BranchData, RepoSnapshot } from '../src/snapshot';
import type { CommitInfo } from '../src/git/repo';
import type { TaskRef } from '../src/git/commitRefs';
import type { Item, Program, SourceFormat, Status } from '../src/model';

function mkItem(id: string, stored: Status = 'open', over: Partial<Item> = {}): Item {
  return {
    id, title: `T ${id}`, group: '', stored, fileDone: false, fileStatusText: '', size: '', priority: '', area: '',
    created: '', note: '', spec: '', evidence: '', historyDate: '', historyCommit: '', depends: [], line: 0, ...over,
  };
}
/** An item the file marks finished (Backlog.md last status / Spec Kit [x]). */
const doneInFile = (id: string) => mkItem(id, 'done', { fileDone: true, fileStatusText: 'Done' });
function prog(path: string, items: Item[], format: SourceFormat = 'docsTasks'): Program {
  return { path, format, title: '', id: '', area: '', created: '', spec: '', items };
}
const ref = (repo: string, id: string): TaskRef => ({ repo, id });
function commit(hash: string, date: string, done: TaskRef[], progress: TaskRef[] = []): CommitInfo {
  return { hash, date, subject: `s ${hash}`, parents: [], refs: { done, progress } };
}
function repo(name: string, programs: Program[], owner = ''): RepoSnapshot {
  return {
    repo: { name, owner, path: `/r/${owner}/${name}`, origin: '', key: `/r/${owner}/${name}` },
    main: { name: 'main', tipRef: 'refs/heads/main', reachRefs: ['refs/heads/main'] },
    formats: [], hasTaskFiles: true, programs, issues: [], mainCommits: [], branches: [], evidence: [],
    sinceCommit: '', hasSinceFile: false, programsAtSince: [], commitsAfterSince: new Set(),
    trustCommit: '', programsAtTrust: [], uncommittedTaskChanges: false, changedFiles: new Map(), error: '',
  };
}
function branch(name: string, commits: CommitInfo[], programs: Program[] = []): BranchData {
  return { tip: { name, ref: `refs/heads/${name}`, hash: commits[0]?.hash ?? '', date: '' }, commits, programs };
}
const one = (s: RepoSnapshot, mode: UnverifiedMode = 'unverified'): Workspace => resolveAll([s], mode);
function must(r: ResolvedItem | undefined): ResolvedItem {
  expect(r).toBeDefined();
  return r!;
}

describe('status engine (PM port)', () => {
  it('task trailer on main closes item', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1')])]);
    s.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'S1')]));
    const r = must(findItem(one(s), 'R', 'S1'));
    expect(r.status).toBe('done');
    expect(r.doneDate).toBe('2026-11-05');
    expect(r.commits.length).toBe(1);
    expect(r.commits[0].closes).toBe(true);
  });

  it('latest closing commit sets date', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1')])]);
    s.mainCommits.push(commit('h2', '2026-11-05', [ref('', 'S1')]));
    s.mainCommits.push(commit('h1', '2026-11-01', [ref('', 'S1')]));
    const r = must(findItem(one(s), 'R', 'S1'));
    expect(r.doneDate).toBe('2026-11-05');
    expect(r.commits.length).toBe(2);
  });

  it('branch only trailer gives on branch', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1')])]);
    s.branches.push(branch('feature/x', [commit('h1', '2026-11-05', [ref('', 'S1')])]));
    const r = must(findItem(one(s), 'R', 'S1'));
    expect(r.status).toBe('onBranch');
    expect(r.branches).toEqual(['feature/x']);
  });

  it('same commit on local and origin branch listed once', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1')])]);
    s.branches.push(branch('feature/x', [commit('h1', '2026-11-05', [ref('', 'S1')])]));
    s.branches.push(branch('origin/feature/x', [commit('h1', '2026-11-05', [ref('', 'S1')])]));
    const r = must(findItem(one(s), 'R', 'S1'));
    expect(r.branches.length).toBe(2);
    expect(r.commits.length).toBe(1);
  });

  it('progress trailer links without closing', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1')])]);
    s.mainCommits.push(commit('h1', '2026-11-05', [], [ref('', 'S1')]));
    const r = must(findItem(one(s), 'R', 'S1'));
    expect(r.status).toBe('open');
    expect(r.commits.length).toBe(1);
    expect(r.commits[0].closes).toBe(false);
  });

  it('history done kept', () => {
    const t = mkItem('S1', 'done', { historyDate: '2026-10-01', fileDone: true });
    const r = must(findItem(one(repo('R', [prog('a.md', [t])])), 'R', 'S1'));
    expect(r.status).toBe('done');
    expect(r.historical).toBe(true);
    expect(r.doneDate).toBe('2026-10-01');
    expect(r.flaggedUnverified).toBe(false);
    expect(r.trustedFromFile).toBe(false);
  });

  it('branch only item added', () => {
    const s = repo('R', [prog('a.md', [mkItem('A1')])]);
    s.branches.push(branch('feature/x', [], [prog('b.md', [mkItem('N1'), mkItem('A1')])]));
    const w = one(s);
    const n = must(findItem(w, 'R', 'N1'));
    expect(n.branchOnly).toBe(true);
    expect(n.status).toBe('onBranch');
    expect(w.items.length).toBe(2);
    const a = must(findItem(w, 'R', 'A1'));
    expect(a.branchOnly).toBe(false);
    expect(a.status).toBe('open');
  });

  it('cross repo trailer', () => {
    const sfea = repo('SFEA', [prog('a.md', [mkItem('G7')])]);
    const addin = repo('AddinA', []);
    addin.mainCommits.push(commit('h1', '2026-11-05', [ref('SFEA', 'G7')]));
    const r = must(findItem(resolveAll([sfea, addin], 'unverified'), 'SFEA', 'G7'));
    expect(r.status).toBe('done');
    expect(r.commits.length).toBe(1);
    expect(r.commits[0].repo).toBe('AddinA');
  });

  it('repo name match is case insensitive', () => {
    const sfea = repo('SFEA', [prog('a.md', [mkItem('G7')])]);
    const addin = repo('AddinA', []);
    addin.mainCommits.push(commit('h1', '2026-11-05', [ref('sfea', 'G7')]));
    const w = resolveAll([sfea, addin], 'unverified');
    expect(must(findItem(w, 'SFEA', 'G7')).status).toBe('done');
    expect(w.unknownRefs).toEqual([]);
  });

  it('same id in two repos stays separate', () => {
    const a = repo('A', [prog('a.md', [mkItem('D1')])]);
    const b = repo('B', [prog('a.md', [mkItem('D1')])]);
    a.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'D1')]));
    const w = resolveAll([a, b], 'unverified');
    expect(must(findItem(w, 'A', 'D1')).status).toBe('done');
    expect(must(findItem(w, 'B', 'D1')).status).toBe('open');
  });

  it('unknown ref collected', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1')])]);
    s.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'ZZ9')]));
    const w = one(s);
    expect(w.unknownRefs.length).toBe(1);
    expect(w.unknownRefs[0].refId).toBe('ZZ9');
    expect(w.unknownRefs[0].hash).toBe('h1');
  });

  it('duplicate id across files collected', () => {
    const first = mkItem('X1', 'open', { title: 'first' });
    const second = mkItem('X1', 'open', { title: 'second' });
    const w = one(repo('R', [prog('a.md', [first]), prog('b.md', [second])]));
    expect(w.duplicates.length).toBe(1);
    expect(w.duplicates[0].paths).toEqual(['a.md', 'b.md']);
    expect(w.items.length).toBe(1);
    expect(must(findItem(w, 'R', 'X1')).item.title).toBe('first');
  });

  it('dropped stays dropped unless closed', () => {
    const w = one(repo('R', [prog('a.md', [mkItem('S1', 'dropped')])]));
    expect(must(findItem(w, 'R', 'S1')).status).toBe('dropped');
  });

  it('workspace program pointer survives move', () => {
    const w = one(repo('R', [prog('a.md', [mkItem('S1')])]));
    const w2: Workspace = { ...w };
    const r = must(findItem(w2, 'R', 'S1'));
    expect(r.program).toBe(w2.snapshots[0].programs[0]);
  });

  it('dropped item closed on main is done', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1', 'dropped')])]);
    s.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'S1')]));
    expect(must(findItem(one(s), 'R', 'S1')).status).toBe('done');
  });

  it('branch-only item closed on main is done', () => {
    const s = repo('R', [prog('a.md', [mkItem('A1')])]);
    s.branches.push(branch('feature/x', [], [prog('a.md', [mkItem('A1'), mkItem('N1')])]));
    s.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'N1')]));
    const r = must(findItem(one(s), 'R', 'N1'));
    expect(r.branchOnly).toBe(true);
    expect(r.status).toBe('done');
    expect(r.doneDate).toBe('2026-11-05');
  });

  it('Task and Task-Progress in one commit give one closing link', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1')])]);
    s.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'S1')], [ref('', 'S1')]));
    const r = must(findItem(one(s), 'R', 'S1'));
    expect(r.commits.length).toBe(1);
    expect(r.commits[0].closes).toBe(true);
    expect(r.status).toBe('done');
  });

  it('Task: OwnRepo:Id closes the item in the same repo', () => {
    const s = repo('R', [prog('a.md', [mkItem('S1')])]);
    s.mainCommits.push(commit('h1', '2026-11-05', [ref('R', 'S1')]));
    const w = one(s);
    expect(must(findItem(w, 'R', 'S1')).status).toBe('done');
    expect(w.unknownRefs).toEqual([]);
  });

  it("same hash in two repos links each repo's own item", () => {
    const a = repo('A', [prog('a.md', [mkItem('D1')])]);
    const b = repo('B', [prog('a.md', [mkItem('D1')])]);
    a.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'D1')]));
    b.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'D1')]));
    const w = resolveAll([a, b], 'unverified');
    for (const name of ['A', 'B']) {
      const r = must(findItem(w, name, 'D1'));
      expect(r.status).toBe('done');
      expect(r.commits.length).toBe(1);
      expect(r.commits[0].repo).toBe(name);
    }
  });

  it('history done with a branch trailer shows on branch', () => {
    // Ruling: a branch close outranks the stored (history) status, as for any stored status.
    const t = mkItem('S1', 'done', { historyDate: '2026-10-01', fileDone: true });
    const s = repo('R', [prog('a.md', [t])]);
    s.branches.push(branch('feature/x', [commit('h1', '2026-11-05', [ref('', 'S1')])]));
    const r = must(findItem(one(s), 'R', 'S1'));
    expect(r.status).toBe('onBranch');
    expect(r.historical).toBe(false);
  });

  it('depends entries resolve like trailers', () => {
    const sfea = repo('SFEA', [prog('a.md', [mkItem('G7')])]);
    const addin = repo('AddinA', [prog('a.md', [mkItem('D1')])]);
    const w = resolveAll([sfea, addin], 'unverified');
    expect(findDependency(w, 'AddinA', 'D1')).toBe(findItem(w, 'AddinA', 'D1'));
    expect(findDependency(w, 'AddinA', 'SFEA:G7')).toBe(findItem(w, 'SFEA', 'G7'));
    expect(findDependency(w, 'AddinA', 'sfea:G7')).toBe(findItem(w, 'SFEA', 'G7'));
    expect(findDependency(w, 'AddinA', 'D1')).toBeDefined();
    expect(findDependency(w, 'AddinA', 'SFEA:G7')).toBeDefined();
    expect(findDependency(w, 'AddinA', 'Nope:G7')).toBeUndefined();
    expect(findDependency(w, 'AddinA', 'G7')).toBeUndefined();
  });
});

describe('status engine (Speclog)', () => {
  const backlog = (items: Item[]) => prog('backlog/tasks/x.md', items, 'backlogMd');

  it('backlog done without commit is unverified by default', () => {
    const r = must(findItem(one(repo('R', [backlog([doneInFile('task-1')])])), 'R', 'task-1'));
    expect(r.status).toBe('unverified');
    expect(r.flaggedUnverified).toBe(false);
    expect(r.trustedFromFile).toBe(false);
    expect(r.historical).toBe(false);
    expect(r.doneDate).toBe('');
    // Spec Kit follows the same rule.
    const k = must(findItem(one(repo('R', [prog('specs/001-a/tasks.md', [doneInFile('001-a/T001')], 'specKit')])),
      'R', '001-a/T001'));
    expect(k.status).toBe('unverified');
  });

  it('mode done shows done and flags', () => {
    const w = one(repo('R', [backlog([doneInFile('task-1'), mkItem('task-2', 'partial')])]), 'done');
    const r = must(findItem(w, 'R', 'task-1'));
    expect(r.status).toBe('done');
    expect(r.flaggedUnverified).toBe(true);
    expect(r.trustedFromFile).toBe(false);
    expect(r.historical).toBe(false);
    expect(r.doneDate).toBe('');
    const open = must(findItem(w, 'R', 'task-2'));
    expect(open.status).toBe('partial');
    expect(open.flaggedUnverified).toBe(false);
  });

  it('mode open ignores file done', () => {
    const w = one(repo('R', [backlog([doneInFile('task-1')])]), 'open');
    const r = must(findItem(w, 'R', 'task-1'));
    expect(r.status).toBe('open');
    expect(r.flaggedUnverified).toBe(false);
    // docs/tasks history done is unaffected by any mode.
    const d = one(repo('R', [prog('a.md', [mkItem('S1', 'done', { fileDone: true, historyDate: '2026-10-01' })])]),
      'open');
    expect(must(findItem(d, 'R', 'S1')).status).toBe('done');
    expect(must(findItem(d, 'R', 'S1')).historical).toBe(true);
  });

  it('trusted cutoff turns earlier file-done into done (trustedFromFile)', () => {
    for (const mode of ['unverified', 'done', 'open'] as UnverifiedMode[]) {
      const s = repo('R', [backlog([doneInFile('task-1')])]);
      s.trustCommit = 'c'.repeat(40);
      s.programsAtTrust = [backlog([doneInFile('TASK-1')])]; // Backlog.md ids ignore case
      const r = must(findItem(one(s, mode), 'R', 'task-1'));
      expect(r.status).toBe('done');
      expect(r.trustedFromFile).toBe(true);
      expect(r.flaggedUnverified).toBe(false);
      expect(r.historical).toBe(false);
      expect(r.doneDate).toBe('');
    }
  });

  it('file done after cutoff is still unverified', () => {
    const s = repo('R', [backlog([doneInFile('task-1'), doneInFile('task-2')])]);
    s.trustCommit = 'c'.repeat(40);
    // At the cutoff task-1 was still open and task-2 did not exist yet.
    s.programsAtTrust = [backlog([mkItem('task-1')])];
    const w = one(s);
    for (const id of ['task-1', 'task-2']) {
      const r = must(findItem(w, 'R', id));
      expect(r.status).toBe('unverified');
      expect(r.trustedFromFile).toBe(false);
    }
    // Spec Kit ids are case-sensitive at the cutoff too.
    const k = repo('R', [prog('specs/a/tasks.md', [doneInFile('a/T001')], 'specKit')]);
    k.trustCommit = 'c'.repeat(40);
    k.programsAtTrust = [prog('specs/a/tasks.md', [doneInFile('A/T001')], 'specKit')];
    expect(must(findItem(one(k), 'R', 'a/T001')).status).toBe('unverified');
  });

  it('Task: line closes a backlog item case-insensitively', () => {
    const s = repo('R', [backlog([mkItem('task-12'), doneInFile('task-13')]), prog('a.md', [mkItem('S1')])]);
    s.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'TASK-12'), ref('', 'Task-13'), ref('', 's1')]));
    const w = one(s);
    const r = must(findItem(w, 'R', 'task-12'));
    expect(r.status).toBe('done');
    expect(r.doneDate).toBe('2026-11-05');
    expect(r.commits.length).toBe(1);
    const d = must(findItem(w, 'R', 'task-13'));
    expect(d.status).toBe('done');
    expect(d.flaggedUnverified).toBe(false);
    expect(d.trustedFromFile).toBe(false);
    expect(d.doneDate).toBe('2026-11-05');
    expect(findItem(w, 'R', 'TASK-12')).toBe(r);
    // docs/tasks ids stay case-sensitive.
    expect(must(findItem(w, 'R', 'S1')).status).toBe('open');
    expect(w.unknownRefs.map((u) => u.refId)).toEqual(['s1']);
    expect(findItem(w, 'R', 's1')).toBeUndefined();
  });

  it('speckit feature-qualified id closes', () => {
    const s = repo('R', [
      prog('specs/001-auth/tasks.md', [mkItem('001-auth/T001')], 'specKit'),
      prog('specs/002-pay/tasks.md', [mkItem('002-pay/T001')], 'specKit'),
    ]);
    s.mainCommits.push(commit('h1', '2026-11-05', [ref('', '001-auth/T001')]));
    s.mainCommits.push(commit('h0', '2026-11-04', [ref('', 'T001'), ref('', '001-AUTH/T001')]));
    const w = one(s);
    expect(must(findItem(w, 'R', '001-auth/T001')).status).toBe('done');
    expect(must(findItem(w, 'R', '002-pay/T001')).status).toBe('open');
    expect(w.unknownRefs.map((u) => u.refId)).toEqual(['T001', '001-AUTH/T001']);
    expect(w.duplicates).toEqual([]);
  });

  it('owner/name qualified ref resolves; bare name shared by two repos is ambiguous', () => {
    const a = repo('Lib', [prog('a.md', [mkItem('L1')])], 'alice');
    const b = repo('Lib', [prog('a.md', [mkItem('L1')])], 'bob');
    const app = repo('App', []);
    app.mainCommits.push(commit('h1', '2026-11-05', [ref('BOB/lib', 'L1')]));
    app.mainCommits.push(commit('h2', '2026-11-04', [ref('lib', 'L1')], [ref('Lib', 'L1')]));
    app.mainCommits.push(commit('h3', '2026-11-03', [ref('carol/Lib', 'L1')]));
    const w = resolveAll([a, b, app], 'unverified');
    const ia = w.items.find((r) => r.repoKey === a.repo.key)!;
    const ib = w.items.find((r) => r.repoKey === b.repo.key)!;
    expect(ib.status).toBe('done');
    expect(ib.commits.map((c) => c.hash)).toEqual(['h1']);
    expect(ia.status).toBe('open');
    expect(ia.commits).toEqual([]);
    // One row per commit and name, ignoring the name's case.
    expect(w.ambiguousRepoRefs).toEqual([{ repo: 'App', repoPath: app.repo.path, hash: 'h2', refRepo: 'lib' }]);
    expect(w.unknownRefs).toEqual([{ repo: 'App', repoPath: app.repo.path, hash: 'h3', refRepo: 'carol/Lib', refId: 'L1' }]);
    // Dependencies follow the same repository rule.
    expect(findDependency(w, 'App', 'bob/Lib:L1')).toBe(ib);
    expect(findDependency(w, 'App', 'Lib:L1')).toBeUndefined();
    expect(findDependency(w, b.repo.key, 'L1')).toBe(ib);
    expect(findItem(w, a.repo.key, 'L1')).toBe(ia);
  });

  it('backlog duplicate ids compare case-insensitively', () => {
    const w = one(repo('R', [
      backlog([mkItem('task-1', 'open', { title: 'first' })]),
      prog('backlog/completed/y.md', [mkItem('TASK-1', 'open', { title: 'second' })], 'backlogMd'),
    ]));
    expect(w.items.length).toBe(1);
    expect(w.duplicates).toEqual([{ repo: 'R', repoPath: '/r//R', id: 'task-1', paths: ['backlog/tasks/x.md', 'backlog/completed/y.md'] }]);
    expect(must(findItem(w, 'R', 'TASK-1')).item.title).toBe('first');
  });

  it('git close outranks file status in every mode; branch-only backlog item is on branch', () => {
    for (const mode of ['unverified', 'done', 'open'] as UnverifiedMode[]) {
      const s = repo('R', [backlog([doneInFile('task-1'), doneInFile('task-2')])]);
      s.branches.push(branch('feature/x', [commit('h1', '2026-11-05', [ref('', 'task-1')])],
        [backlog([doneInFile('task-1'), doneInFile('task-2'), doneInFile('task-3')])]));
      const w = one(s, mode);
      expect(must(findItem(w, 'R', 'task-1')).status).toBe('onBranch');
      expect(must(findItem(w, 'R', 'task-1')).flaggedUnverified).toBe(false);
      expect(must(findItem(w, 'R', 'task-3')).status).toBe('onBranch');
      expect(must(findItem(w, 'R', 'task-3')).branchOnly).toBe(true);
    }
  });

  it('two clones of one origin keep their own items', () => {
    const a = repo('R', [prog('a.md', [mkItem('A1')])]);
    const b = repo('R', [prog('a.md', [mkItem('B1')])]);
    b.repo.key = a.repo.key; // the same origin URL
    b.repo.path = '/clone2/R';
    b.mainCommits.push(commit('h1', '2026-11-05', [ref('', 'B1'), ref('', 'A1')]));
    const w = resolveAll([a, b], 'unverified');
    const ra = must(findItem(w, a.repo.path, 'A1'));
    const rb = must(findItem(w, '/clone2/R', 'B1'));
    expect(ra.repoPath).toBe(a.repo.path);
    expect(rb.repoPath).toBe('/clone2/R');
    expect(rb.status).toBe('done');
    // A Task line in clone B does not close clone A's item.
    expect(ra.status).toBe('open');
    // The record belongs to clone B, where the commit is.
    expect(w.unknownRefs).toEqual([{ repo: 'R', repoPath: '/clone2/R', hash: 'h1', refRepo: '', refId: 'A1' }]);
    // A shared name or key gives the first clone; its path picks the clone.
    expect(findItem(w, 'R', 'A1')).toBe(ra);
    expect(findItem(w, a.repo.key, 'B1')).toBeUndefined();
    expect(findItem(w, '/clone2/R', 'A1')).toBeUndefined();
    expect(findDependency(w, '/clone2/R', 'B1')).toBe(rb);
  });

  it('clones of one origin are one repository for Task: Name:Id', () => {
    const a = repo('Lib', [prog('a.md', [mkItem('X')])], 'alice');
    const b = repo('Lib', [prog('a.md', [mkItem('X')])], 'alice');
    b.repo.path = '/clone2/Lib';
    const app = repo('App', []);
    app.mainCommits.push(commit('h1', '2026-11-05', [ref('Lib', 'X')]));
    const w = resolveAll([a, b, app], 'unverified');
    expect(w.ambiguousRepoRefs).toEqual([]);
    expect(w.unknownRefs).toEqual([]);
    const first = must(findItem(w, a.repo.path, 'X'));
    expect(first.status).toBe('done');
    expect(first.commits.map((c) => c.repo)).toEqual(['App']);
    expect(must(findItem(w, '/clone2/Lib', 'X')).status).toBe('open');
    expect(findDependency(w, 'App', 'lib:X')).toBe(first);
  });

  it('a bare name naming the committing repository resolves to it', () => {
    const a = repo('Lib', [prog('a.md', [mkItem('L1')])], 'alice');
    const b = repo('Lib', [prog('a.md', [mkItem('L1')])], 'bob');
    b.mainCommits.push(commit('h1', '2026-11-05', [ref('LIB', 'L1')]));
    const w = resolveAll([a, b], 'unverified');
    expect(w.ambiguousRepoRefs).toEqual([]);
    expect(must(findItem(w, b.repo.path, 'L1')).status).toBe('done');
    expect(must(findItem(w, a.repo.path, 'L1')).status).toBe('open');
    expect(findDependency(w, b.repo.path, 'lib:L1')).toBe(findItem(w, b.repo.path, 'L1'));
    expect(findDependency(w, a.repo.path, 'Lib:L1')).toBe(findItem(w, a.repo.path, 'L1'));
  });

  it('findItem accepts a repository key, path or name (name ignoring case)', () => {
    const s = repo('Repo', [prog('a.md', [mkItem('S1')])]);
    s.repo.key = 'https://example.com/o/Repo.git';
    s.repo.path = '/work/Repo';
    const w = one(s);
    const r = must(findItem(w, 'Repo', 'S1'));
    expect(findItem(w, 'repo', 'S1')).toBe(r);
    expect(findItem(w, 'https://example.com/o/Repo.git', 'S1')).toBe(r);
    expect(findItem(w, '/work/Repo', 'S1')).toBe(r);
    expect(findItem(w, '/WORK/REPO', 'S1')).toBeUndefined();
  });
});
