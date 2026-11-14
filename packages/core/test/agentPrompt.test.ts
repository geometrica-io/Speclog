import { describe, it, expect } from 'vitest';
import { agentAvailability, sourceBranch } from '../src/agentPrompt';
import { ResolvedItem, Workspace, resolveAll } from '../src/status';
import type { RepoSnapshot } from '../src/snapshot';
import type { Item, Program, Status } from '../src/model';

function item(id: string, stored: Status = 'open', depends: string[] = []): Item {
  return {
    id, title: '', group: '', stored, fileDone: false, fileStatusText: '', size: '', priority: '', area: '',
    created: '', note: '', spec: '', evidence: '', historyDate: '', historyCommit: '', depends, line: 0,
  };
}
function prog(items: Item[]): Program {
  return { path: 'docs/tasks/a.md', format: 'docsTasks', title: '', id: '', area: '', created: '', spec: '', items };
}
function snap(programs: Program[], error = ''): RepoSnapshot {
  const p = '/r/R';
  return {
    repo: { name: 'R', owner: '', path: p, origin: '', key: p },
    main: { name: 'main', tipRef: 'refs/heads/main', reachRefs: ['refs/heads/main'] },
    formats: ['docsTasks'], hasTaskFiles: true, programs, issues: [], mainCommits: [], branches: [], evidence: [],
    sinceCommit: '', hasSinceFile: false, programsAtSince: [], commitsAfterSince: new Set(),
    trustCommit: '', programsAtTrust: [], uncommittedTaskChanges: false, changedFiles: new Map(), error,
  };
}
function setup(items: Item[], error = ''): { w: Workspace; s: RepoSnapshot } {
  const s = snap([prog(items)], error);
  return { w: resolveAll([s], 'unverified'), s };
}
function resolved(w: Workspace, s: RepoSnapshot, partial: Partial<ResolvedItem> = {}): ResolvedItem {
  return {
    repo: 'R', repoKey: s.repo.key, repoPath: s.repo.path, program: s.programs[0], item: s.programs[0].items[0],
    status: 'open', historical: false, trustedFromFile: false, flaggedUnverified: false, branchOnly: false,
    doneDate: '', branches: [], commits: [], ...partial,
  };
}

describe('agentAvailability', () => {
  it('done and dropped are disabled', () => {
    const { w, s } = setup([item('A.1')]);
    for (const st of ['done', 'dropped'] as Status[]) {
      const a = agentAvailability(w, resolved(w, s, { status: st }));
      expect(a.enabled).toBe(false);
      expect(a.reason).toContain(st);
    }
  });

  it('git error disables', () => {
    const { w, s } = setup([item('A.1')], 'fatal: x');
    const a = agentAvailability(w, resolved(w, s));
    expect(a.enabled).toBe(false);
    expect(a.reason).not.toBe('');
  });

  it('open item has no guards', () => {
    const { w, s } = setup([item('A.1')]);
    for (const st of ['open', 'partial', 'bug', 'verify'] as Status[]) {
      const a = agentAvailability(w, resolved(w, s, { status: st }));
      expect(a.enabled).toBe(true);
      expect(a.reason).toBe('');
      expect(a.guards.length).toBe(0);
    }
  });

  it('decision adds a guard', () => {
    const { w, s } = setup([item('A.1')]);
    const a = agentAvailability(w, resolved(w, s, { status: 'decision' }));
    expect(a.enabled).toBe(true);
    expect(a.guards.map((g) => g.kind)).toEqual(['decision']);
    expect(a.guards[0].promptLine).toContain('ask me before writing code');
  });

  it('open dependency adds a guard', () => {
    const { w } = setup([item('A.0', 'open', ['A.1', 'A.2', 'A.9']), item('A.1', 'done'), item('A.2', 'open')]);
    const r = w.items.find((x) => x.item.id === 'A.0')!;
    const a = agentAvailability(w, r);
    expect(a.guards.map((g) => g.kind)).toEqual(['openDepends']);
    expect(a.guards[0].message).toContain('A.2');
    expect(a.guards[0].message).not.toContain('A.1');
    expect(a.guards[0].message).toContain('A.9 (not found)');
  });

  it('onBranch names the branch', () => {
    const { w, s } = setup([item('A.1')]);
    const a = agentAvailability(w, resolved(w, s, { status: 'onBranch', branches: ['feature/x'] }));
    expect(a.guards.map((g) => g.kind)).toEqual(['onBranch']);
    expect(a.guards[0].message).toContain('feature/x');
    expect(a.guards[0].promptLine).toContain('feature/x');
  });

  it('unverified adds a guard', () => {
    const { w, s } = setup([item('A.1')]);
    const a = agentAvailability(w, resolved(w, s, { status: 'unverified' }));
    expect(a.guards.map((g) => g.kind)).toEqual(['unverified']);
    expect(a.guards[0].message).toContain('no evidence in git');
  });

  it('guards combine in order', () => {
    const { w } = setup([item('A.0', 'decision', ['A.2']), item('A.2', 'open')]);
    const r = { ...w.items.find((x) => x.item.id === 'A.0')!, status: 'decision' as Status };
    const a = agentAvailability(w, r);
    expect(a.guards.map((g) => g.kind)).toEqual(['decision', 'openDepends']);
    const b = agentAvailability(w, { ...r, status: 'onBranch', branches: ['f/x'] });
    expect(b.guards.map((g) => g.kind)).toEqual(['openDepends', 'onBranch']);
  });
});

describe('sourceBranch', () => {
  it('main item gives the main branch', () => {
    const { w, s } = setup([item('A.1')]);
    expect(sourceBranch(w, resolved(w, s))).toBe('main');
  });

  it('branch-only item gives its branch', () => {
    const { w, s } = setup([item('A.1')]);
    const bp = prog([item('B.1')]);
    s.branches.push({ tip: { name: 'feature/y', ref: 'refs/heads/feature/y', hash: 'h', date: '' }, programs: [bp], commits: [] });
    const r = resolved(w, s, { program: bp, item: bp.items[0], branchOnly: true });
    expect(sourceBranch(w, r)).toBe('feature/y');
  });
});
