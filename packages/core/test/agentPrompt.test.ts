import { describe, it, expect } from 'vitest';
import { agentAvailability, sourceBranch, buildAgentPrompt, closingRules } from '../src/agentPrompt';
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
    expect(a.reason).toContain('fatal: x');
  });

  it('unscanned repository is disabled', () => {
    const { w, s } = setup([item('A.1')]);
    const a = agentAvailability(w, resolved(w, s, { repoPath: '/elsewhere' }));
    expect(a.enabled).toBe(false);
    expect(a.reason).toBe('Repository not scanned yet.');
  });

  it('dropped dependency counts as closed', () => {
    const { w } = setup([item('A.0', 'open', ['A.1']), item('A.1', 'dropped')]);
    const a = agentAvailability(w, w.items.find((x) => x.item.id === 'A.0')!);
    expect(a.guards.length).toBe(0);
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
  it('branch-only item found on no branch falls back to r.branches, else empty', () => {
    const { w, s } = setup([item('A.1')]);
    expect(sourceBranch(w, resolved(w, s, { branchOnly: true, branches: ['f/z'] }))).toBe('f/z');
    expect(sourceBranch(w, resolved(w, s, { branchOnly: true }))).toBe('');
  });

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

describe('buildAgentPrompt', () => {
  function mk(over: Partial<Item> = {}, progOver: Partial<Program> = {}, rOver: Partial<ResolvedItem> = {}) {
    const it = { ...item('BL52.2'), title: 'Load case buckling', line: 7, ...over };
    const { w, s } = setup([it]);
    Object.assign(s.programs[0], { path: 'docs/tasks/bl-52.md', ...progOver });
    s.repo.name = 'SFEA';
    return { w, s, r: resolved(w, s, { repo: 'SFEA', item: it, ...rOver }) };
  }

  it('built-in prompt for a docs/tasks item', () => {
    const { w, r } = mk();
    const t = buildAgentPrompt(w, r, '');
    for (const x of ['BL52.2', 'Load case buckling', 'main:docs/tasks/bl-52.md:7', 'Work only in the repository at', 'Task: BL52.2',
      'Never write "status: done"', 'When done, tell me the branch', 'Start from an up-to-date main branch']) {
      expect(t.text).toContain(x);
    }
    expect(t.guardsOmitted).toBe(false);
    expect(t.unknownPlaceholders).toEqual([]);
  });

  it('backlog and spec kit closing rules mention marking the file', () => {
    expect(closingRules('backlogMd', 'task-12')).toContain('Task: task-12');
    expect(closingRules('backlogMd', 'task-12')).toContain('status field');
    expect(closingRules('specKit', 'T1')).toContain('[x]');
    expect(closingRules('docsTasks', 'T1')).not.toContain('[x]');
  });

  it('spec line only when a spec exists', () => {
    const a = mk();
    expect(buildAgentPrompt(a.w, a.r, '').text).not.toContain('Spec:');
    const b = mk({}, { spec: 'docs/specs/x.md' });
    expect(buildAgentPrompt(b.w, b.r, '').text).toContain('Spec: docs/specs/x.md');
  });

  it('depends with statuses', () => {
    const { w } = setup([item('BL52.2', 'open', ['A.1', 'A.2']), item('A.1', 'done'), item('A.2', 'open')]);
    const r = w.items.find((x) => x.item.id === 'BL52.2')!;
    expect(buildAgentPrompt(w, r, '{depends}').text).toBe('A.1 (done), A.2 (open)');
  });

  it('branch-only item cites its branch', () => {
    const { w, s } = mk();
    const bp = prog([item('B.1')]);
    s.branches.push({ tip: { name: 'feature/y', ref: 'refs/heads/feature/y', hash: 'h', date: '' }, programs: [bp], commits: [] });
    const t = buildAgentPrompt(w, resolved(w, s, { program: bp, item: bp.items[0], branchOnly: true }), '').text;
    expect(t).toContain('feature/y:docs/tasks/');
    expect(t).toContain('Continue on branch feature/y');
  });

  it('branch-only item without a known branch omits the branch cleanly', () => {
    const { w, s } = mk();
    const t = buildAgentPrompt(w, resolved(w, s, { branchOnly: true }), '').text;
    expect(t).toContain('Task file: docs/tasks/');
    expect(t).not.toContain('Start from');
    expect(t).not.toContain('Continue on branch');
    expect(t).not.toContain('{branch}');
  });

  it('onBranch item cites the closing branch', () => {
    const { w, r } = mk({}, {}, { status: 'onBranch', branches: ['feature/x'] });
    expect(buildAgentPrompt(w, r, '').text).toContain('Continue on branch feature/x');
  });

  it('decision guard reaches the built-in prompt', () => {
    const { w, r } = mk({}, {}, { status: 'decision' });
    expect(buildAgentPrompt(w, r, '').text).toContain('ask me before writing code');
  });

  it('custom template substitutes and reports unknowns', () => {
    const { w, r } = mk();
    const t = buildAgentPrompt(w, r, '/gorev {repo}:{id} {nope} {nope}');
    expect(t.text).toBe('/gorev SFEA:BL52.2 {nope} {nope}');
    expect(t.unknownPlaceholders).toEqual(['nope']);
  });

  it('custom template without guards placeholder', () => {
    const { w, r } = mk({}, {}, { status: 'decision' });
    const t = buildAgentPrompt(w, r, '/gorev {id}');
    expect(t.guardsOmitted).toBe(true);
    expect(t.text).toBe('/gorev BL52.2');
    expect(buildAgentPrompt(w, r, '/gorev {id} {guards}').guardsOmitted).toBe(false);
  });

  it('template keeps non-placeholder braces', () => {
    const { w, r } = mk();
    const t = buildAgentPrompt(w, r, '{ "a": 1 } {{id}}');
    expect(t.text).toBe('{ "a": 1 } {BL52.2}');
    expect(t.unknownPlaceholders).toEqual([]);
  });

  it('paths pass through', () => {
    const { w, s } = mk({}, { path: 'docs\\tasks\\bl-52.md' });
    const r = resolved(w, s, { repo: 'SFEA', repoPath: 'C:\\Users\\Ali Ş\\repo' });
    const t = buildAgentPrompt(w, r, '{repoPath}|{file}').text;
    expect(t).toBe('C:\\Users\\Ali Ş\\repo|docs/tasks/bl-52.md');
  });
});
