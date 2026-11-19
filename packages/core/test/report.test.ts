import { describe, it, expect } from 'vitest';
import { buildReport, percent } from '../src/report';
import type { ReportInput, ReportModel } from '../src/report';
import { resolveAll } from '../src/status';
import type { Workspace } from '../src/status';
import type { BranchData, RepoSnapshot } from '../src/snapshot';
import type { CommitInfo } from '../src/git/repo';
import type { TaskRef } from '../src/git/commitRefs';
import type { Item, Program, Status } from '../src/model';

function mkItem(id: string, stored: Status = 'open', over: Partial<Item> = {}): Item {
  return {
    id, title: `T ${id}`, group: '', stored, fileDone: false, fileStatusText: '', size: '', priority: '', area: '',
    created: '', note: '', spec: '', evidence: '', historyDate: '', historyCommit: '', depends: [], line: 0, ...over,
  };
}
const prog = (path: string, items: Item[]): Program =>
  ({ path, format: 'docsTasks', title: '', id: '', area: '', created: '', spec: '', items });
const ref = (id: string): TaskRef => ({ repo: '', id });
function commit(hash: string, date: string, done: TaskRef[], progress: TaskRef[] = []): CommitInfo {
  return { hash, date, subject: `s ${hash}`, parents: [], refs: { done, progress } };
}
function repo(name: string, programs: Program[], commits: CommitInfo[] = [], branches: BranchData[] = []): RepoSnapshot {
  return {
    repo: { name, owner: '', path: `/r/${name}`, origin: '', key: `/r/${name}` },
    main: { name: 'main', tipRef: 'refs/heads/main', reachRefs: ['refs/heads/main'] },
    formats: [], hasTaskFiles: true, programs, issues: [], mainCommits: commits, branches, evidence: [],
    sinceCommit: '', hasSinceFile: false, programsAtSince: [], commitsAfterSince: new Set(),
    trustCommit: '', programsAtTrust: [], uncommittedTaskChanges: false, changedFiles: new Map(), error: '',
  };
}
const ws = (...s: RepoSnapshot[]): Workspace => resolveAll(s, 'unverified');
const PERIOD = { preset: 'custom' as const, from: '2026-11-10', to: '2026-11-16' };
const DAYS = ['2026-11-09', '2026-11-16'];

function build(start: Workspace, end: Workspace, over: Partial<ReportInput> = {}): ReportModel {
  return buildReport({
    period: PERIOD, start, end, endIsLive: false,
    curve: [{ day: DAYS[0], workspace: start }, { day: DAYS[1], workspace: end }],
    selectedRepoPaths: ['/r/R'], ...over,
  });
}
const ids = (l: { id: string }[]): string[] => l.map((x) => x.id);

describe('buildReport', () => {
  it('Finished: done at end, not done at start', () => {
    const start = ws(repo('R', [prog('a.md', [mkItem('A'), mkItem('B')])], [commit('h0', '2026-11-01', [ref('B')])]));
    const end = ws(repo('R', [prog('a.md', [mkItem('A'), mkItem('B')])], [
      commit('h2', '2026-11-12', [ref('A')]), commit('h1', '2026-11-12', [ref('A')]), commit('h0', '2026-11-01', [ref('B')]),
    ]));
    const r = build(start, end).repos[0];
    expect(ids(r.finished)).toEqual(['A']);
    expect(r.finished[0].closedDate).toBe('2026-11-12');
    expect(r.finished[0].closedCommit).toEqual({ hash: 'h2', subject: 's h2' });
    expect(r.start).toEqual({ done: 1, total: 2 });
    expect(r.end).toEqual({ done: 2, total: 2 });
  });

  it('Finished without a closing commit (history done) has no closedCommit', () => {
    const hist = mkItem('H', 'done', { historyDate: '2026-11-12' });
    const start = ws(repo('R', [prog('a.md', [])]));
    const end = ws(repo('R', [prog('a.md', [hist])]));
    const r = build(start, end).repos[0];
    expect(ids(r.finished)).toEqual(['H']);
    expect(r.finished[0].closedDate).toBe('2026-11-12');
    expect(r.finished[0].closedCommit).toBeUndefined();
  });

  it('In progress: onBranch and branchOnly only when the end is live; branchOnly is outside every total', () => {
    const branches = [branch('feature/x', [commit('hb', '2026-11-14', [ref('A'), ref('N')])])];
    const snap = (): RepoSnapshot => repo('R', [prog('a.md', [mkItem('A')])], [], branches);
    const live = build(ws(repo('R', [prog('a.md', [mkItem('A')])])), ws(snap()), { endIsLive: true }).repos[0];
    expect(live.inProgress.map((i) => [i.id, i.progressReason?.kind])).toEqual([['A', 'onBranch']]);
    expect(live.inProgress[0].progressReason?.branches).toEqual(['feature/x']);
    expect(live.end).toEqual({ done: 0, total: 1 });
    const past = build(ws(repo('R', [prog('a.md', [mkItem('A')])])), ws(snap()), { endIsLive: false }).repos[0];
    expect(past.inProgress.map((i) => i.id)).toEqual(['A']); // via the commit dated in the period
    expect(past.inProgress[0].progressReason?.kind).toBe('commit');
  });

  it('In progress lists a branch-only item with reason branchOnly when live, never when not', () => {
    const branchSnap = (): RepoSnapshot => repo('R', [prog('a.md', [mkItem('A')])]);
    const b = branchSnap();
    b.branches.push(branch('feature/y', [commit('hb', '2026-11-14', [])], [prog('a.md', [mkItem('A'), mkItem('NEW', 'open', { line: 5 })])]));
    const start = ws(branchSnap());
    const live = build(start, ws(b), { endIsLive: true }).repos[0];
    expect(live.inProgress.map((i) => [i.id, i.progressReason?.kind])).toEqual([['NEW', 'branchOnly']]);
    expect(live.end.total).toBe(1);
    expect(live.added).toEqual([]);
    expect(live.remaining.map((i) => i.id)).toEqual(['A']);
    const past = build(start, ws(b), { endIsLive: false }).repos[0];
    expect(past.inProgress).toEqual([]);
  });

  it('In progress: partial, and a Task-Progress commit dated in the period', () => {
    const items = (): Item[] => [mkItem('P', 'partial'), mkItem('C'), mkItem('OLD'), mkItem('NONE')];
    const commits = [
      commit('h3', '2026-11-20', [], [ref('NONE')]), // after the period
      commit('h2', '2026-11-11', [], [ref('C')]),
      commit('h1', '2026-11-05', [], [ref('OLD')]), // before the period
    ];
    const start = ws(repo('R', [prog('a.md', items())]));
    const end = ws(repo('R', [prog('a.md', items())], commits));
    const r = build(start, end).repos[0];
    expect(r.inProgress.map((i) => [i.id, i.progressReason?.kind, i.progressReason?.date])).toEqual([
      ['P', 'partial', ''], ['C', 'commit', '2026-11-11'],
    ]);
    expect(ids(r.remaining)).toEqual(['OLD', 'NONE']);
  });

  it('Remaining: other end items not done and not dropped', () => {
    const items = [mkItem('O'), mkItem('B', 'bug'), mkItem('V', 'verify'), mkItem('D', 'decision'), mkItem('X', 'dropped')];
    const s = ws(repo('R', [prog('a.md', items)]));
    const r = build(s, s).repos[0];
    expect(ids(r.remaining)).toEqual(['O', 'B', 'V', 'D']);
    expect(r.end).toEqual({ done: 0, total: 4 });
  });

  it('Reopened: done at start, not done at end', () => {
    const start = ws(repo('R', [prog('a.md', [mkItem('A')])], [commit('h0', '2026-11-01', [ref('A')])]));
    const end = ws(repo('R', [prog('a.md', [mkItem('A', 'bug')])]));
    const r = build(start, end).repos[0];
    expect(r.changed.map((i) => [i.id, i.change])).toEqual([['A', 'reopened']]);
    expect(r.remaining).toEqual([]);
  });

  it('dropped item: changed dropped and out of the end total', () => {
    const start = ws(repo('R', [prog('a.md', [mkItem('A'), mkItem('B')])]));
    const end = ws(repo('R', [prog('a.md', [mkItem('A', 'dropped'), mkItem('B')])]));
    const r = build(start, end).repos[0];
    expect(r.changed.map((i) => [i.id, i.change])).toEqual([['A', 'dropped']]);
    expect(r.start.total).toBe(2);
    expect(r.end.total).toBe(1);
  });

  it('deleted item: changed removed', () => {
    const start = ws(repo('R', [prog('a.md', [mkItem('A'), mkItem('B')])]));
    const end = ws(repo('R', [prog('a.md', [mkItem('A')])]));
    const r = build(start, end).repos[0];
    expect(r.changed.map((i) => [i.id, i.change, i.status])).toEqual([['B', 'removed', 'open']]);
  });

  it('Added: absent at start, flagged isNew in its state list too', () => {
    const start = ws(repo('R', [prog('a.md', [mkItem('A')])]));
    const end = ws(repo('R', [prog('a.md', [mkItem('A'), mkItem('N', 'open', { created: '2026-11-11' }), mkItem('M')])],
      [commit('h1', '2026-11-12', [ref('M')])]));
    const r = build(start, end).repos[0];
    expect(r.added.map((i) => [i.id, i.created, i.isNew])).toEqual([['N', '2026-11-11', true], ['M', '', true]]);
    expect(r.remaining.map((i) => [i.id, i.isNew])).toEqual([['A', false], ['N', true]]);
    expect(r.finished.map((i) => [i.id, i.isNew])).toEqual([['M', true]]);
  });

  it('start/end Progress follow the board rule: dropped out, unverified not done', () => {
    const unv = mkItem('U', 'done', { fileDone: true });
    const f = (): Program => ({ ...prog('a.md', [mkItem('A'), unv, mkItem('X', 'dropped')]), format: 'backlogMd' });
    const s = ws(repo('R', [f()]));
    const r = build(s, s).repos[0];
    expect(s.items.find((i) => i.item.id === 'U')?.status).toBe('unverified');
    expect(r.end).toEqual({ done: 0, total: 2 });
  });

  it('program breakdown per program path', () => {
    const start = ws(repo('R', [prog('a.md', [mkItem('A')]), prog('b.md', [mkItem('B')])]));
    const end = ws(repo('R', [prog('a.md', [mkItem('A')]), prog('b.md', [mkItem('B')])], [commit('h1', '2026-11-12', [ref('B')])]));
    const r = build(start, end).repos[0];
    expect(r.programs.map((p) => [p.path, p.start, p.end])).toEqual([
      ['a.md', { done: 0, total: 1 }, { done: 0, total: 1 }],
      ['b.md', { done: 0, total: 1 }, { done: 1, total: 1 }],
    ]);
  });

  it('lists are sorted by program path then line', () => {
    const s = ws(repo('R', [prog('b.md', [mkItem('B2', 'open', { line: 9 }), mkItem('B1', 'open', { line: 2 })]),
      prog('a.md', [mkItem('A1', 'open', { line: 7 })])]));
    expect(ids(build(s, s).repos[0].remaining)).toEqual(['A1', 'B1', 'B2']);
  });

  it('percent', () => {
    expect(percent({ done: 0, total: 0 })).toBeNull();
    expect(percent({ done: 1, total: 3 })).toBe(33);
    expect(percent({ done: 2, total: 3 })).toBe(67);
  });

  it('a repository absent from start: all items added, start total 0', () => {
    const start = ws(repo('Other', [prog('a.md', [mkItem('Z')])]));
    const end = ws(repo('Other', [prog('a.md', [mkItem('Z')])]), repo('R', [prog('a.md', [mkItem('A'), mkItem('B')])]));
    const r = build(start, end).repos[0];
    expect(r.start).toEqual({ done: 0, total: 0 });
    expect(ids(r.added)).toEqual(['A', 'B']);
    expect(r.name).toBe('R');
    expect(r.curve[0]).toEqual({ done: 0, total: 0 });
  });

  it('only selected repositories appear, in order; total sums them; curve per day', () => {
    const mk = (done: boolean): Workspace => ws(
      repo('R', [prog('a.md', [mkItem('A'), mkItem('B')])], done ? [commit('h1', '2026-11-12', [ref('A')])] : []),
      repo('S', [prog('a.md', [mkItem('C')])]),
      repo('T', [prog('a.md', [mkItem('D')])]),
    );
    const start = mk(false);
    const end = mk(true);
    const m = build(start, end, { selectedRepoPaths: ['/r/S', '/r/R'] });
    expect(m.repos.map((r) => r.name)).toEqual(['S', 'R']);
    expect(m.total.start).toEqual({ done: 0, total: 3 });
    expect(m.total.end).toEqual({ done: 1, total: 3 });
    expect(m.curveDays).toEqual(DAYS);
    expect(m.total.curve).toEqual([{ done: 0, total: 3 }, { done: 1, total: 3 }]);
    expect(m.repos[1].curve).toEqual([{ done: 0, total: 2 }, { done: 1, total: 2 }]);
    expect(m.startDay).toBe('2026-11-09');
  });
});

function branch(name: string, commits: CommitInfo[], programs: Program[] = []): BranchData {
  return { tip: { name, ref: `refs/heads/${name}`, hash: commits[0]?.hash ?? '', date: '' }, commits, programs };
}
