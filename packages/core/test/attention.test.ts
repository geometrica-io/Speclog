// Port of ProjectManager tests/AttentionTests.cpp (same case names) plus Speclog extras.
import { describe, it, expect } from 'vitest';
import { AttentionConfig, AttentionItem, AttentionKind, FetchState, computeAttention, evidenceConflicts } from '../src/attention';
import { ResolvedItem, UnverifiedMode, Workspace, resolveAll } from '../src/status';
import type { BranchData, RepoSnapshot } from '../src/snapshot';
import type { CommitInfo } from '../src/git/repo';
import type { Item, Program, SourceFormat, Status } from '../src/model';
import { daysBetween } from '../src/text';

function item(id: string, stored: Status = 'open', over: Partial<Item> = {}): Item {
  return {
    id, title: '', group: '', stored, fileDone: false, fileStatusText: '', size: '', priority: '', area: '',
    created: '', note: '', spec: '', evidence: '', historyDate: '', historyCommit: '', depends: [], line: 0, ...over,
  };
}
function prog(items: Item[], format: SourceFormat = 'docsTasks', path = 'docs/tasks/a.md'): Program {
  return { path, format, title: '', id: '', area: '', created: '', spec: '', items };
}
function commit(hash: string, date: string, parents: string[] = ['p']): CommitInfo {
  return { hash, date, subject: '', parents, refs: { done: [], progress: [] } };
}
function repo(name = 'R', path = ''): RepoSnapshot {
  const p = path || `/r/${name}`;
  return {
    repo: { name, owner: '', path: p, origin: '', key: p },
    main: { name: 'main', tipRef: 'refs/heads/main', reachRefs: ['refs/heads/main'] },
    formats: ['docsTasks'], hasTaskFiles: true, programs: [], issues: [], mainCommits: [], branches: [], evidence: [],
    sinceCommit: '', hasSinceFile: false, programsAtSince: [], commitsAfterSince: new Set(),
    trustCommit: '', programsAtTrust: [], uncommittedTaskChanges: false, changedFiles: new Map(), error: '',
  };
}
function repoS12(): RepoSnapshot {
  const s = repo();
  s.programs.push(prog([item('S1'), item('S2')]));
  return s;
}
const one = (s: RepoSnapshot, mode: UnverifiedMode = 'unverified'): Workspace => resolveAll([s], mode);
const cfg = (): AttentionConfig => ({ today: '2026-11-10', staleBranchDays: 7, recentDays: 30, fetchFailSeconds: 3600 });
const run = (w: Workspace, f: FetchState[] = [], now = 100000): AttentionItem[] => computeAttention(w, cfg(), f, now);
function branch(date: string, withTask: boolean): BranchData {
  const c = commit('b1', date);
  if (withTask) {
    c.refs.done.push({ repo: '', id: 'S2' });
    c.refs.progress.push({ repo: '', id: 'S1' });
  }
  return { tip: { name: 'feat/x', ref: 'refs/heads/feat/x', hash: 'b1', date }, programs: [], commits: [c] };
}
const count = (v: AttentionItem[], k: AttentionKind) => v.filter((a) => a.kind === k).length;

describe('attention (PM port)', () => {
  it('DaysBetween', () => {
    expect(daysBetween('2026-11-03', '2026-11-10')).toBe(7);
    expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-11-10', '2026-11-03')).toBe(-7);
    expect(daysBetween('garbage', '2026-11-03')).toBe(0);
  });

  it('stale branch', () => {
    const s = repoS12();
    s.branches.push(branch('2026-10-31', true));
    const v = run(one(s));
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('staleBranch');
    expect(v[0].ref).toBe('feat/x');
    expect(v[0].detail).toBe('10 days; S1, S2');
    expect(v[0].days).toBe(10);
    expect(v[0].code).toBe('S1, S2');

    const young = repoS12();
    young.branches.push(branch('2026-11-07', true));
    expect(run(one(young))).toEqual([]);

    const noTask = repo();
    noTask.branches.push(branch('2026-10-11', false));
    expect(run(one(noTask))).toEqual([]);

    const edge = repoS12(); // exactly 7 days is not stale
    edge.branches.push(branch('2026-11-03', true));
    expect(run(one(edge))).toEqual([]);
  });

  it('untagged commit after since', () => {
    const make = (files: string[], parents: string[], since: string) => {
      const s = repoS12();
      s.sinceCommit = since;
      s.mainCommits.push(commit('new', '2026-11-09', parents), commit('since', '2026-11-01'), commit('old', '2026-10-30'));
      s.changedFiles.set('new', files);
      s.changedFiles.set('old', ['src/old.cpp']);
      if (since === 'since') s.commitsAfterSince = new Set(['new']);
      return s;
    };
    const v = run(one(make(['src/a.cpp'], ['p'], 'since')));
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('untaggedCommit');
    expect(v[0].ref).toBe('new');

    expect(run(one(make(['docs/x.md'], ['p'], 'since')))).toEqual([]);
    expect(run(one(make(['src/a.cpp'], ['p1', 'p2'], 'since')))).toEqual([]);
    expect(run(one(make(['src/a.cpp'], ['p'], '')))).toEqual([]);
    expect(run(one(make(['src/a.cpp'], ['p'], 'missing')))).toEqual([]);
    expect(count(run(one(make(['docs/x.md', 'src/b.cpp'], ['p'], 'since'))), 'untaggedCommit')).toBe(1);

    const tagged = make(['src/a.cpp'], ['p'], 'since');
    tagged.mainCommits[0].refs.progress.push({ repo: '', id: 'S1' });
    expect(run(one(tagged))).toEqual([]);
  });

  it('evidence conflict', () => {
    const go = (expectPresent: boolean, found: boolean, st: Status) => {
      const s = repo();
      s.programs.push(prog([item('S1', st)]));
      s.evidence.push({ id: 'S1', found, expectPresent });
      return count(run(one(s)), 'evidenceConflict');
    };
    expect(go(true, true, 'open')).toBe(1);
    expect(go(false, false, 'open')).toBe(1);
    expect(go(true, false, 'open')).toBe(0);
    expect(go(false, true, 'open')).toBe(0);
    expect(go(true, true, 'dropped')).toBe(0);
    expect(go(false, false, 'dropped')).toBe(0);
  });

  it('evidence conflict against done items', () => {
    const go = (expectPresent: boolean, found: boolean) => {
      const s = repo();
      s.programs.push(prog([item('S1')]));
      const c = commit('h', '2026-11-01');
      c.refs.done.push({ repo: '', id: 'S1' }); // trailer on main makes it done
      s.mainCommits.push(c);
      s.evidence.push({ id: 'S1', found, expectPresent });
      const v = run(one(s));
      for (const a of v) if (a.kind === 'evidenceConflict') expect(a.ref).toBe('S1');
      return count(v, 'evidenceConflict');
    };
    expect(go(true, false)).toBe(1);
    expect(go(false, true)).toBe(1);
    expect(go(true, true)).toBe(0);
    expect(go(false, false)).toBe(0);
  });

  it('history done after since', () => {
    const make = (atSince: Status, presentAtSince: boolean) => {
      const s = repo();
      s.hasSinceFile = true;
      s.sinceCommit = 'abc';
      s.programs.push(prog([item('S1', 'done')]));
      if (presentAtSince) s.programsAtSince.push(prog([item('S1', atSince)]));
      return s;
    };
    expect(count(run(one(make('open', true))), 'historyDoneAfterSince')).toBe(1);
    expect(count(run(one(make('open', false))), 'historyDoneAfterSince')).toBe(1);
    expect(count(run(one(make('done', true))), 'historyDoneAfterSince')).toBe(0);
    const none = make('open', true);
    none.sinceCommit = '';
    expect(count(run(one(none)), 'historyDoneAfterSince')).toBe(0);
  });

  it('no task files', () => {
    const s = repo();
    s.hasTaskFiles = false;
    const v = run(one(s));
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('noTaskFiles');
    expect(v[0].repo).toBe('R');

    const err = repo();
    err.hasTaskFiles = false;
    err.error = 'boom';
    expect(count(run(one(err)), 'noTaskFiles')).toBe(0);
  });

  it('unknown ref', () => {
    const s = repo();
    const c = commit('deadbeef', '2026-11-01');
    c.refs.done.push({ repo: 'Other', id: 'Zzz' });
    s.mainCommits.push(c);
    const w = one(s);
    expect(w.unknownRefs.length).toBe(1);
    const v = run(w);
    expect(count(v, 'unknownRef')).toBe(1);
    for (const a of v) {
      if (a.kind !== 'unknownRef') continue;
      expect(a.ref).toBe('deadbeef');
      expect(a.detail).toBe('Other:Zzz');
    }
  });

  it('duplicate id', () => {
    const s = repo();
    s.programs.push(prog([item('S1')], 'docsTasks', 'docs/tasks/a.md'), prog([item('S1')], 'docsTasks', 'docs/tasks/b.md'));
    const v = run(one(s));
    expect(count(v, 'duplicateId')).toBe(1);
    for (const x of v) {
      if (x.kind !== 'duplicateId') continue;
      expect(x.ref).toBe('S1');
      expect(x.detail).toBe('docs/tasks/a.md, docs/tasks/b.md');
    }
  });

  it('format issue carries line', () => {
    const s = repo();
    s.issues.push({ path: 'docs/tasks/a.md', line: 42, kind: 'bad-status', detail: 'weird' });
    const v = run(one(s));
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('formatIssue');
    expect(v[0].line).toBe(42);
    expect(v[0].ref).toBe('docs/tasks/a.md');
    expect(v[0].detail).toBe('bad-status: weird');
    expect(v[0].code).toBe('bad-status');
  });

  it('format issue rows for unsupported and bad-trust', () => {
    const s = repo();
    s.issues.push({ path: '', line: 0, kind: 'bad-trust', detail: 'zz: no such commit' });
    s.issues.push({ path: 'backlog/config.yml', line: 1, kind: 'unsupported', detail: 'x' });
    const v = run(one(s));
    expect(v.map((a) => a.code).sort()).toEqual(['bad-trust', 'unsupported']);
  });

  it('fetch failing over an hour', () => {
    const w = one(repo());
    const f: FetchState = { repo: 'R', lastOkUnix: 100, firstFailUnix: 100000 - 3700, lastError: 'no network' };
    const v = run(w, [f]);
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('fetchFailing');
    expect(v[0].repo).toBe('R');
    expect(v[0].detail).toContain('no network');

    expect(run(w, [{ ...f, firstFailUnix: 100000 - 1200 }])).toEqual([]);
    expect(run(w, [{ ...f, lastOkUnix: 100000 - 10 }])).toEqual([]); // recovered since
    expect(run(w, [{ ...f, firstFailUnix: 0, lastOkUnix: 0 }])).toEqual([]);
  });

  it('git error surfaces', () => {
    const s = repo();
    s.error = 'git not found';
    const v = run(one(s));
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('gitError');
    expect(v[0].detail).toBe('git not found');
  });

  it('output ordered by kind then repo then ref', () => {
    const a = repo('B');
    a.issues.push({ path: 'z.md', line: 1, kind: 'syntax', detail: 'x' }, { path: 'a.md', line: 1, kind: 'syntax', detail: 'x' });
    const b = repo('A');
    b.issues.push({ path: 'm.md', line: 1, kind: 'syntax', detail: 'x' });
    b.hasTaskFiles = false;
    const r = run(resolveAll([a, b], 'unverified'));
    expect(r.length).toBe(4);
    expect(r[0].kind).toBe('formatIssue');
    expect(r[0].repo).toBe('A');
    expect(r[1].repo).toBe('B');
    expect(r[1].ref).toBe('a.md');
    expect(r[2].ref).toBe('z.md');
    expect(r[3].kind).toBe('noTaskFiles');
  });

  it('evidence conflict helper and structured fields', () => {
    const it = (st: Status) => ({ status: st }) as ResolvedItem;
    const ev = (found: boolean, expectPresent: boolean) => ({ id: 'S1', found, expectPresent });
    expect(evidenceConflicts(it('open'), ev(true, true))).toBe(true);
    expect(evidenceConflicts(it('open'), ev(false, true))).toBe(false);
    expect(evidenceConflicts(it('done'), ev(false, true))).toBe(true);
    expect(evidenceConflicts(it('done'), ev(true, true))).toBe(false);
    expect(evidenceConflicts(it('bug'), ev(false, false))).toBe(true);
    expect(evidenceConflicts(it('bug'), ev(true, false))).toBe(false);
    expect(evidenceConflicts(it('done'), ev(true, false))).toBe(true);
    expect(evidenceConflicts(it('done'), ev(false, false))).toBe(false);
    expect(evidenceConflicts(it('dropped'), ev(true, true))).toBe(false);
    expect(evidenceConflicts(it('dropped'), ev(false, false))).toBe(false);

    const s = repo();
    s.programs.push(prog([item('S1')]));
    s.evidence.push({ id: 'S1', found: false, expectPresent: false });
    const v = run(one(s));
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('evidenceConflict');
    expect(v[0].expectPresent).toBe(false);
    expect(v[0].found).toBe(false);
    expect(v[0].code).toBe('absent');
    expect(v[0].detail).toBe('absent: not found');

    const p = repo();
    p.programs.push(prog([item('S1')]));
    p.evidence.push({ id: 'S1', found: true, expectPresent: true });
    const w = run(one(p));
    expect(w.length).toBe(1);
    expect(w[0].expectPresent).toBe(true);
    expect(w[0].found).toBe(true);
    expect(w[0].code).toBe('present');
  });

  it('untagged commits come from the after-since set, not list position', () => {
    const s = repoS12();
    s.sinceCommit = 'since';
    s.mainCommits.push(commit('merge', '2026-11-09', ['since', 'side']), commit('since', '2026-11-05'),
      commit('side', '2026-11-03'), commit('before', '2026-11-04'));
    s.changedFiles = new Map([['side', ['src/s.cpp']], ['before', ['src/b.cpp']], ['merge', ['src/s.cpp']]]);
    s.commitsAfterSince = new Set(['merge', 'side']);
    const v = run(one(s));
    expect(count(v, 'untaggedCommit')).toBe(1);
    expect(v[0].ref).toBe('side');
  });

  it('untagged commit: task-file changes of the formats in use are not code', () => {
    const make = (formats: SourceFormat[], files: string[]) => {
      const s = repo();
      s.formats = formats;
      s.programs.push(prog([item('task-1')], 'backlogMd', 'backlog/tasks/task-1 - X.md'));
      s.trustCommit = 'trust';
      s.mainCommits.push(commit('new', '2026-11-09'));
      s.changedFiles.set('new', files);
      s.commitsAfterSince = new Set(['new']);
      return count(run(one(s)), 'untaggedCommit');
    };
    expect(make(['backlogMd'], ['backlog/tasks/x.md'])).toBe(0);
    expect(make(['backlogMd'], ['.backlog/tasks/x.md', 'backlog.config.yml'])).toBe(0);
    expect(make(['backlogMd'], ['docs/notes.md'])).toBe(0); // docs/ stays exempt (PM parity)
    expect(make(['backlogMd'], ['backlog/tasks/x.md', 'src/a.ts'])).toBe(1);
    expect(make(['specKit'], ['specs/001-a/tasks.md', 'specs/001-a/plan.md'])).toBe(0);
    // Only the formats the repository uses: backlog/ is code in a Spec Kit-only repository.
    expect(make(['specKit'], ['backlog/tasks/x.md'])).toBe(1);
    expect(make(['backlogMd'], ['backlogs/x.md'])).toBe(1);
    expect(make(['backlogMd'], ['backlog.config.yml.bak'])).toBe(1);
  });

  it('untagged commits older than recentDays are not listed', () => {
    const s = repoS12();
    s.sinceCommit = 'since';
    s.mainCommits.push(commit('recent', '2026-11-01'), commit('old', '2026-09-01'));
    s.changedFiles = new Map([['recent', ['src/a.cpp']], ['old', ['src/b.cpp']]]);
    s.commitsAfterSince = new Set(['recent', 'old']);
    const w = one(s);
    const n = (recentDays: number) => count(computeAttention(w, { ...cfg(), recentDays }, [], 100000), 'untaggedCommit');
    expect(n(30)).toBe(1);
    expect(n(5)).toBe(0);
    expect(n(9)).toBe(1); // exactly 9 days old: still inside
  });

  it('status done without a .since file', () => {
    const s = repo();
    s.programs.push(prog([item('S0'), item('S1', 'done', { line: 7 }), item('S2', 'done')]));
    const v = run(one(s));
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('formatIssue');
    expect(v[0].code).toBe('done-without-since');
    expect(v[0].ref).toBe('docs/tasks/a.md');
    expect(v[0].line).toBe(7);
    expect(v[0].detail).toBe('done-without-since: S1, S2');

    const none = repo();
    none.programs.push(prog([item('S1')]));
    expect(run(one(none))).toEqual([]);
  });

  it('stale branch: local and origin copy give one row', () => {
    const s = repoS12();
    const local = branch('2026-10-20', true);
    const remote = branch('2026-10-31', true);
    remote.tip.name = 'origin/feat/x';
    remote.commits[0].refs.done = [{ repo: '', id: 'S1' }];
    remote.commits[0].refs.progress = [];
    s.branches.push(remote, local);
    const v = run(one(s));
    expect(count(v, 'staleBranch')).toBe(1);
    expect(v[0].ref).toBe('feat/x');
    expect(v[0].days).toBe(10); // the newer copy
    expect(v[0].code).toBe('S1, S2');

    const young = repoS12(); // one copy is fresh: not stale
    const fresh = branch('2026-11-09', true);
    fresh.tip.name = 'origin/feat/x';
    young.branches.push(branch('2026-10-01', true), fresh);
    expect(count(run(one(young)), 'staleBranch')).toBe(0);
  });
});

describe('attention (Speclog extras)', () => {
  const hand = (items: Item[], format: SourceFormat = 'backlogMd') => prog(items, format, 'backlog/tasks/x.md');
  const doneInFile = (id: string) => item(id, 'done', { fileDone: true, fileStatusText: 'Done' });

  it('file done without git produces item rows and one summary per repo', () => {
    const s = repo();
    s.programs.push(hand([doneInFile('task-1'), doneInFile('task-2'), item('task-3')]));
    const other = repo('Q');
    other.programs.push(hand([item('task-9')]));
    const v = run(resolveAll([s, other], 'unverified'));
    const rows = v.filter((a) => a.kind === 'fileDoneNoGit');
    expect(rows.map((a) => [a.repo, a.ref, a.detail])).toEqual([['R', 'task-1', 'Done'], ['R', 'task-2', 'Done']]);
    const sum = v.filter((a) => a.kind === 'unverifiedSummary');
    expect(sum.length).toBe(1);
    expect(sum[0].repo).toBe('R');
    expect(sum[0].count).toBe(2);
    expect(sum[0].ref).toBe('');

    // mode "done": still flagged
    const flagged = run(resolveAll([s], 'done'));
    expect(count(flagged, 'fileDoneNoGit')).toBe(2);
    expect(count(flagged, 'unverifiedSummary')).toBe(1);
    // mode "open": ignored
    expect(count(run(resolveAll([s], 'open')), 'fileDoneNoGit')).toBe(0);
  });

  it('git done but file open is reported', () => {
    const s = repo();
    s.programs.push(hand([item('task-1'), item('task-2', 'open')], 'backlogMd'));
    const c = commit('h', '2026-11-01');
    c.refs.done.push({ repo: '', id: 'task-1' });
    s.mainCommits.push(c);
    const v = run(one(s));
    const rows = v.filter((a) => a.kind === 'gitDoneFileOpen');
    expect(rows.length).toBe(1);
    expect(rows[0].ref).toBe('task-1');

    // docs/tasks items closed by a commit are normal, no row
    const d = repo();
    d.programs.push(prog([item('S1')]));
    d.mainCommits.push({ ...commit('h', '2026-11-01'), refs: { done: [{ repo: '', id: 'S1' }], progress: [] } });
    expect(count(run(one(d)), 'gitDoneFileOpen')).toBe(0);

    // closed and the file agrees: no row
    const ok = repo();
    ok.programs.push(hand([doneInFile('task-1')]));
    ok.mainCommits.push({ ...commit('h', '2026-11-01'), refs: { done: [{ repo: '', id: 'task-1' }], progress: [] } });
    expect(count(run(one(ok)), 'gitDoneFileOpen')).toBe(0);
  });

  it('untagged commits only with a cutoff', () => {
    const mk = (since: string, trust: string) => {
      const s = repoS12();
      s.sinceCommit = since;
      s.trustCommit = trust;
      s.mainCommits.push(commit('new', '2026-11-09'));
      s.changedFiles.set('new', ['src/a.cpp']);
      s.commitsAfterSince = new Set(['new']);
      return s;
    };
    expect(count(run(one(mk('', ''))), 'untaggedCommit')).toBe(0);
    expect(count(run(one(mk('', 'tr'))), 'untaggedCommit')).toBe(1);
    expect(count(run(one(mk('sn', ''))), 'untaggedCommit')).toBe(1);
  });

  it('uncommitted task changes row', () => {
    const s = repo();
    s.uncommittedTaskChanges = true;
    const v = run(one(s));
    expect(v.length).toBe(1);
    expect(v[0].kind).toBe('uncommittedTaskChanges');
    expect(v[0].repo).toBe('R');
    expect(v[0].repoPath).toBe('/r/R');
  });

  it('ambiguous repo ref row', () => {
    const app = repo('App');
    const a = repo('Lib', '/x/Lib');
    const b = repo('Lib', '/y/Lib');
    app.mainCommits.push({ ...commit('h2', '2026-11-01'), refs: { done: [{ repo: 'lib', id: 'L1' }], progress: [] } });
    const w = resolveAll([app, a, b], 'unverified');
    const v = run(w);
    const rows = v.filter((x) => x.kind === 'ambiguousRepoRef');
    expect(rows.length).toBe(1);
    expect(rows[0].repo).toBe('App');
    expect(rows[0].ref).toBe('h2');
    expect(rows[0].detail).toBe('lib');
  });

  it('carries repoPath and orders kinds as declared', () => {
    const s = repo();
    s.error = 'boom';
    s.uncommittedTaskChanges = true;
    s.issues.push({ path: 'a.md', line: 1, kind: 'syntax', detail: 'x' });
    const v = run(one(s));
    expect(v.map((a) => a.kind)).toEqual(['formatIssue', 'gitError', 'uncommittedTaskChanges']);
    expect(v.every((a) => a.repoPath === '/r/R')).toBe(true);
  });
});
