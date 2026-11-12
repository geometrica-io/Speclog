// Port of ProjectManager tests/ViewTreeTests.cpp (same case names) plus Speclog extras.
import { describe, it, expect } from 'vitest';
import {
  FilterPreset, NO_AREA_KEY, NO_DATE_KEY, TreeNode, ViewMode, applyPreset, buildTree, countByStatus, defaultFilter,
  matches, narrowing,
} from '../src/viewTree';
import { Workspace, resolveAll } from '../src/status';
import type { BranchData, RepoSnapshot } from '../src/snapshot';
import type { Item, Program, SourceFormat, Status } from '../src/model';

function item(id: string, area = '', created = '', stored: Status = 'open', group = '', over: Partial<Item> = {}): Item {
  return {
    id, title: `T ${id}`, group, stored, fileDone: false, fileStatusText: '', size: '', priority: '', area, created,
    note: '', spec: '', evidence: '', historyDate: '', historyCommit: '', depends: [], line: 0, ...over,
  };
}
function prog(path: string, title: string, items: Item[], format: SourceFormat = 'docsTasks'): Program {
  return { path, format, title, id: '', area: '', created: '', spec: '', items };
}
function repo(name: string, programs: Program[], path = `/r/${name}`, key = path): RepoSnapshot {
  return {
    repo: { name, owner: '', path, origin: '', key },
    main: { name: 'main', tipRef: 'refs/heads/main', reachRefs: ['refs/heads/main'] },
    formats: ['docsTasks'], hasTaskFiles: true, programs, issues: [], mainCommits: [], branches: [], evidence: [],
    sinceCommit: '', hasSinceFile: false, programsAtSince: [], commitsAfterSince: new Set(),
    trustCommit: '', programsAtTrust: [], uncommittedTaskChanges: false, changedFiles: new Map(), error: '',
  };
}
const make = (...v: RepoSnapshot[]): Workspace => resolveAll(v, 'unverified');
const child = (n: TreeNode, label: string) => n.children.find((c) => c.label === label);
function collectKeys(n: TreeNode, out: string[] = []): string[] {
  out.push(n.key);
  for (const c of n.children) collectKeys(c, out);
  return out;
}
const MODES: ViewMode[] = ['program', 'area', 'time'];

describe('view tree (PM port)', () => {
  it('program view repo program group item', () => {
    const w = make(
      repo('SFEA', [prog('docs/tasks/a.md', 'Alpha', [item('A1'), item('A2', '', '', 'open', 'G'), item('A3'), item('A4', '', '', 'open', 'G')])]),
      repo('GSG', [prog('docs/tasks/b.md', 'Beta', [item('B1')])]),
    );
    const t = buildTree(w, 'program', defaultFilter());
    expect(t.children.map((c) => c.label)).toEqual(['GSG', 'SFEA']);
    const sfea = t.children[1];
    expect(sfea.children.length).toBe(1);
    expect(sfea.children[0].label).toBe('Alpha');
    const p = sfea.children[0];
    expect(p.children.length).toBe(3);
    expect(p.children[0].item!.item.id).toBe('A1');
    expect(p.children[1].label).toBe('G');
    expect(p.children[1].children.map((c) => c.item!.item.id)).toEqual(['A2', 'A4']);
    expect(p.children[2].item!.item.id).toBe('A3');
    expect(p.children[1].key).toBe('p//r/SFEA/docs/tasks/a.md/g/G');
    expect(p.children[0].key).toBe('i//r/SFEA/A1');
    expect(sfea.key).toBe('p//r/SFEA');
  });

  it('area view splits path across repos', () => {
    const w = make(
      repo('SFEA', [prog('a.md', 'A', [item('S1', 'Tasarım/EC3/Burkulma'), item('S2')])]),
      repo('GSG', [prog('b.md', 'B', [item('G1', 'Tasarım/EC2')])]),
    );
    const t = buildTree(w, 'area', defaultFilter());
    expect(t.children.length).toBe(2);
    const d = child(t, 'Tasarım')!;
    expect(d.children.map((c) => c.label)).toEqual(['EC2', 'EC3']);
    expect(d.children[1].children[0].label).toBe('Burkulma');
    expect(d.children[1].children[0].children[0].item!.item.id).toBe('S1');
    expect(t.children[1].label).toBe('(no area)');
    expect(t.children[1].key).toBe(NO_AREA_KEY);
    expect(d.key).toBe('a/Tasarım');
  });

  it('time view year-month then day oldest first', () => {
    const w = make(repo('R', [prog('a.md', 'A', [
      item('X1', '', '2026-08-21'), item('X2', '', '2026-11-07'), item('X3', '', '2026-11-02'), item('X4')])]));
    const t = buildTree(w, 'time', defaultFilter());
    expect(t.children.map((c) => c.label)).toEqual(['2026-08', '2026-11', '(no date)']);
    expect(t.children[0].children[0].label).toBe('2026-08-21');
    expect(t.children[1].children.map((c) => c.label)).toEqual(['2026-11-02', '2026-11-07']);
    expect(t.children[2].key).toBe(NO_DATE_KEY);
    expect(t.children[1].children[0].key).toBe('t/2026-11/2026-11-02');
  });

  it('counts ignore filter', () => {
    const w = make(repo('R', [prog('a.md', 'A', [item('X1', '', '', 'done'), item('X2'), item('X3')])]));
    for (const r of w.items) if (r.item.id === 'X1') r.status = 'done'; // stored done is history-only
    const t = buildTree(w, 'program', applyPreset('done'));
    expect(t.children.length).toBe(1);
    const p = t.children[0].children[0];
    expect(p.children.length).toBe(1);
    expect(p.done).toBe(1);
    expect(p.total).toBe(3);
    expect(t.done).toBe(1);
    expect(t.total).toBe(3);
  });

  it('empty branches hidden', () => {
    const w = make(repo('R', [prog('a.md', 'A', [item('X1')]), prog('b.md', 'B', [item('Y1', '', '', 'bug')])]));
    const t = buildTree(w, 'program', applyPreset('bugs'));
    expect(t.children.length).toBe(1);
    expect(t.children[0].children.length).toBe(1);
    expect(t.children[0].children[0].label).toBe('B');
  });

  it('dropped excluded by default', () => {
    const w = make(repo('R', [prog('a.md', 'A', [item('X1'), item('X2', '', '', 'dropped')])]));
    const t = buildTree(w, 'program', defaultFilter());
    const p = t.children[0].children[0];
    expect(p.children.length).toBe(1);
    expect(p.total).toBe(1);
    const all = buildTree(w, 'program', applyPreset('all'));
    expect(all.children[0].children[0].children.length).toBe(2);
    expect(all.total).toBe(1);
  });

  it('search folds turkish', () => {
    const a = item('S5.3', '', '', 'open', '', { title: 'Yük durumu tabanlı BURKULMA' });
    const b = item('Z1', '', '', 'open', '', { note: 'ilgili Burkulma notu' });
    const c = item('Q1');
    const w = make(repo('R', [prog('a.md', 'A', [a, b, c])]));
    const f = defaultFilter();
    f.search = 'burkulma';
    expect(matches(w.items[0], f)).toBe(true);
    expect(matches(w.items[1], f)).toBe(true);
    expect(matches(w.items[2], f)).toBe(false);
    f.search = 's5.3';
    expect(matches(w.items[0], f)).toBe(true);
    expect(matches(w.items[1], f)).toBe(false);
    f.search = 'TABANLI';
    expect(matches(w.items[0], f)).toBe(true);
  });

  it('presets', () => {
    const o = applyPreset('open');
    expect(o.statuses.has('done')).toBe(false);
    expect(o.statuses.has('dropped')).toBe(false);
    expect(o.statuses.has('onBranch')).toBe(true);
    expect(o.statuses.has('bug')).toBe(true);
    expect([...applyPreset('bugs').statuses]).toEqual(['bug']);
    expect([...applyPreset('done').statuses]).toEqual(['done']);
    expect([...applyPreset('onBranch').statuses]).toEqual(['onBranch']);
    expect(applyPreset('all').statuses.has('dropped')).toBe(true);
    expect(defaultFilter().statuses.has('dropped')).toBe(false);
    expect(defaultFilter().statuses.size).toBe(8);
  });

  it('open preset includes unverified', () => {
    expect(applyPreset('open').statuses.has('unverified')).toBe(true);
    expect(defaultFilter().statuses.has('unverified')).toBe(true);
  });

  it('repo and size filters', () => {
    const w = make(
      repo('SFEA', [prog('a.md', 'A', [item('M1', '', '', 'open', '', { size: 'M' }), item('L1', '', '', 'open', '', { size: 'L' }), item('N1')])]),
      repo('GSG', [prog('b.md', 'B', [item('G1')])]),
    );
    const n = (f: ReturnType<typeof defaultFilter>) => w.items.filter((r) => matches(r, f)).length;
    const f = defaultFilter();
    f.hiddenRepos = new Set(['/r/GSG']);
    expect(n(f)).toBe(3);
    // Only listed repositories are hidden: one not named (found later) stays visible.
    const g = defaultFilter();
    g.hiddenRepos = new Set(['Other']);
    expect(n(g)).toBe(4);
    const s = defaultFilter();
    s.sizes = new Set(['M']);
    expect(n(s)).toBe(1);
    s.sizes = new Set(['']);
    expect(n(s)).toBe(2);
    expect(countByStatus(w, f).get('open')).toBe(3);
  });

  it('keys stable across rebuild', () => {
    const w = make(repo('R', [prog('a.md', 'A', [item('X1', 'A/B', '2026-01-02')])]));
    for (const m of MODES) {
      const a = buildTree(w, m, defaultFilter());
      const b = buildTree(w, m, defaultFilter());
      let x = a, y = b;
      while (x.children.length > 0) {
        expect(x.key).toBe(y.key);
        x = x.children[0];
        y = y.children[0];
      }
      expect(x.key).toBe('i//r/R/X1');
      expect(y.key).toBe('i//r/R/X1');
    }
  });

  it('program view lists repos without items', () => {
    const bare = repo('Bare', [prog('a.md', 'A', [])]);
    const broken = repo('Broken', []);
    broken.error = 'git failed';
    const empty = repo('Empty', []);
    empty.hasTaskFiles = false;
    const w = make(repo('Full', [prog('a.md', 'A', [item('F1')])]), empty, bare, broken);

    const t = buildTree(w, 'program', defaultFilter());
    expect(t.children.length).toBe(4);
    const e = child(t, 'Empty')!;
    expect(e.key).toBe('p//r/Empty');
    expect(e.children.length).toBe(1);
    expect(e.children[0].placeholder).toBe(true);
    expect(e.children[0].label).toBe('No task files');
    expect(e.children[0].key).toBe('p//r/Empty/\u0001none');
    expect(e.children[0].item).toBeUndefined();
    expect(e.done).toBe(0);
    expect(e.total).toBe(0);
    expect(child(t, 'Bare')!.children[0].label).toBe('No task items');
    expect(child(t, 'Broken')!.children[0].label).toBe('Git error');
    expect(child(t, 'Full')!.children.length).toBe(1);
    expect(child(t, 'Full')!.children[0].placeholder).toBe(false);

    // Default and "All" keep them; a narrowing filter drops them; hiding the repo drops it too.
    expect(child(buildTree(w, 'program', applyPreset('all')), 'Empty')).toBeDefined();
    const search = defaultFilter();
    search.search = 'zzz-no-match';
    const s = buildTree(w, 'program', search);
    expect(child(s, 'Full')).toBeUndefined();
    expect(child(s, 'Empty')).toBeUndefined();
    expect(s.children).toEqual([]);
    expect(child(buildTree(w, 'program', applyPreset('bugs')), 'Empty')).toBeUndefined();
    const sized = defaultFilter();
    sized.sizes = new Set(['M']);
    expect(child(buildTree(w, 'program', sized), 'Empty')).toBeUndefined();
    const withDropped = applyPreset('all');
    withDropped.statuses.delete('dropped');
    expect(narrowing(withDropped)).toBe(false);
    expect(narrowing(applyPreset('open'))).toBe(true);
    const hidden = defaultFilter();
    hidden.hiddenRepos = new Set(['/r/Empty']);
    const h = buildTree(w, 'program', hidden);
    expect(child(h, 'Empty')).toBeUndefined();
    expect(child(h, 'Bare')).toBeDefined();

    // Other views are built from items only.
    const a = buildTree(w, 'area', defaultFilter());
    expect(a.children.length).toBe(1);
    expect(a.children[0].children.length).toBe(1);
  });

  it('keys are unique and stable over every node', () => {
    const r = repo('R', [
      prog('docs/tasks/a.md', 'A', [item('D1', '~', '2026-01-02'), item('X1')]),
      prog('docs/tasks/b.md', 'B', [item('D1', 'A/B', '2026-02-03', 'open', 'G')]),
    ]);
    const b: BranchData = {
      tip: { name: 'feature/x', ref: 'refs/heads/feature/x', hash: 'b1', date: '2026-01-01' },
      programs: [prog('docs/tasks/c.md', 'C', [item('N1', 'A/B')])], commits: [],
    };
    r.branches.push(b);
    const w = make(r, repo('S', [prog('docs/tasks/a.md', 'A', [item('D1')])]));
    for (const m of MODES) {
      const a = collectKeys(buildTree(w, m, applyPreset('all')));
      expect(collectKeys(buildTree(w, m, applyPreset('all')))).toEqual(a);
      expect(new Set(a).size).toBe(a.length);
    }
    const area = buildTree(w, 'area', defaultFilter());
    const tilde = child(area, '~')!;
    expect(tilde.key).not.toBe(NO_AREA_KEY);
    expect(child(area, '(no area)')).toBeDefined();
    expect(area.children[area.children.length - 1].key).toBe(NO_AREA_KEY);
  });

  it('branch-only items appear in every view', () => {
    const r = repo('R', [prog('docs/tasks/a.md', 'A', [item('A1')])]);
    r.branches.push({
      tip: { name: 'feature/x', ref: 'refs/heads/feature/x', hash: 'b1', date: '2026-01-01' },
      programs: [prog('docs/tasks/a.md', 'A', [item('A1'), item('N1', 'X', '2026-03-04')])], commits: [],
    });
    const w = make(r);
    const p = buildTree(w, 'program', defaultFilter());
    expect(p.children.length).toBe(1);
    expect(collectKeys(p).filter((k) => k === 'i//r/R/N1').length).toBe(1);
    const x = child(buildTree(w, 'area', defaultFilter()), 'X')!;
    expect(x.children[0].item!.status).toBe('onBranch');
    expect(child(buildTree(w, 'time', defaultFilter()), '2026-03')).toBeDefined();
  });

  it('a filter matching nothing leaves an empty root', () => {
    const w = make(repo('R', [prog('a.md', 'A', [item('X1', 'A', '2026-01-02')])]));
    const none = defaultFilter();
    none.statuses = new Set();
    for (const m of MODES) {
      const t = buildTree(w, m, none);
      expect(t.key).toBe('root');
      expect(t.children).toEqual([]);
      expect(t.total).toBe(1); // counts stay filter-independent
    }
  });
});

describe('view tree (Speclog extras)', () => {
  it('unverified counted separately, not as done', () => {
    const w = make(repo('R', [prog('a.md', 'A', [item('X1'), item('X2'), item('X3'), item('X4', '', '', 'dropped')])]));
    w.items[0].status = 'unverified';
    w.items[1].status = 'done';
    const t = buildTree(w, 'program', applyPreset('done'));
    expect(t.done).toBe(1);
    expect(t.unverified).toBe(1);
    expect(t.total).toBe(3);
    expect(t.children[0].unverified).toBe(1);
    expect(t.children[0].children[0].children.length).toBe(1); // only the done item matches
  });

  it('backlog and speckit programs appear under their repo', () => {
    const w = make(repo('R', [
      prog('specs/001-x/tasks.md', 'Spec', [item('001-x/T001')], 'specKit'),
      prog('backlog/tasks', 'Backlog', [item('task-1')], 'backlogMd'),
      prog('docs/tasks/a.md', 'Docs', [item('A1')], 'docsTasks'),
    ]));
    const t = buildTree(w, 'program', defaultFilter());
    expect(t.children.length).toBe(1);
    // format order: docsTasks, backlogMd, specKit
    expect(t.children[0].children.map((c) => c.label)).toEqual(['Docs', 'Backlog', 'Spec']);
  });

  it('clones of one repository are separate nodes, hidden together by repo key', () => {
    const w = make(
      repo('App', [prog('a.md', 'A', [item('X1')])], '/work/one/App', 'git@h:o/App.git'),
      repo('App', [prog('a.md', 'A', [item('X1')])], '/work/two/App', 'git@h:o/App.git'),
    );
    const t = buildTree(w, 'program', defaultFilter());
    expect(t.children.map((c) => c.key)).toEqual(['p//work/one/App', 'p//work/two/App']);
    expect(t.children.map((c) => c.label)).toEqual(['App (one/App)', 'App (two/App)']);
    const f = defaultFilter();
    f.hiddenRepos = new Set(['git@h:o/App.git']);
    expect(buildTree(w, 'program', f).children).toEqual([]);
  });

  it('countByStatus ignores statuses but honours search', () => {
    const w = make(repo('R', [prog('a.md', 'A', [item('X1'), item('X2', '', '', 'dropped'), item('Y1', '', '', 'bug')])]));
    const f = applyPreset('done');
    f.search = 'x';
    const c = countByStatus(w, f);
    expect(c.get('open')).toBe(1);
    expect(c.get('dropped')).toBe(1);
    expect(c.get('bug')).toBeUndefined();
  });
});

// Type check helper so unused imports fail loudly.
const _preset: FilterPreset = 'all';
void _preset;
